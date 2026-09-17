import type {
  AssistantResponse,
  Evidence,
  InvestigationLimits,
  InvestigationResult,
  InvestigationStopReason,
  Message,
  ToolCall,
  ToolDefinition,
  ToolExecutionResult
} from "./types.js";
import { DuplicateOutcomeTracker, EvidenceCollector, formatEvidenceToolMessage, validateCitations } from "./evidence.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { LlmProvider } from "../llm/provider.js";

export interface InvestigationDependencies {
  provider: LlmProvider;
  registry: ToolRegistry;
  systemPrompt: string;
  limits: InvestigationLimits;
  /** Explicit values to redact from successful tool content. */
  knownSecrets?: Iterable<string>;
  now?: () => number;
  timers?: InvestigationTimers;
  onDiagnostic?: (event: InvestigationDiagnostic) => void;
}

export type InvestigationDiagnostic =
  | { readonly kind: "model-response"; readonly response: AssistantResponse }
  | { readonly kind: "tool-result"; readonly call: ToolCall; readonly result: ToolExecutionResult };

/** Injectable timer boundary for deterministic deadline and timeout tests. */
export interface InvestigationTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

type AbortCause = "caller" | "deadline" | "operation-timeout";

type OperationOutcome<T> = { state: "completed"; value: T } | { state: "failed" } | { state: "aborted"; cause: AbortCause };

const systemTimers: InvestigationTimers = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

/**
 * Bounded model/tool loop. It is intentionally provider-agnostic so fixtures
 * and a live Docker backend can exercise the same investigation behavior.
 */
export async function investigate(
  question: string,
  dependencies: InvestigationDependencies,
  signal: AbortSignal = new AbortController().signal
): Promise<InvestigationResult> {
  const now = dependencies.now ?? Date.now;
  const timers = dependencies.timers ?? systemTimers;
  const startedAt = now();
  const deadlineAt = startedAt + dependencies.limits.deadlineMs;
  const deadlineController = new AbortController();
  const deadlineTimer = timers.setTimeout(() => deadlineController.abort(), dependencies.limits.deadlineMs);
  const messages: Message[] = [
    { role: "system", content: dependencies.systemPrompt },
    { role: "user", content: question }
  ];
  const evidence: Evidence[] = [];
  const evidenceCollector = new EvidenceCollector({
    maxCharsPerResult: dependencies.limits.maxCharsPerResult,
    maxEvidenceChars: dependencies.limits.maxEvidenceChars,
    knownSecrets: dependencies.knownSecrets
  });
  const duplicateOutcomes = new DuplicateOutcomeTracker();
  let modelCalls = 0;
  let toolCalls = 0;
  // Keep one call available for a tool-free final answer. This also means a
  // configuration of one model call can synthesize from the initial prompt,
  // but cannot select tools.
  const normalModelCallLimit = Math.max(0, dependencies.limits.maxModelCalls - 1);

  try {
    while (modelCalls < normalModelCallLimit) {
      const stopped = stopReason();
      if (stopped) return synthesizeOrPartial(stopped);

      modelCalls += 1;
      const modelOutcome = await runChild(
        (childSignal) => dependencies.provider.respond(messages, dependencies.registry.list(), childSignal),
        dependencies.limits.modelTimeoutMs
      );
      if (modelOutcome.state === "aborted") {
        return synthesizeOrPartial(modelOutcome.cause === "caller" ? "cancelled" : modelOutcome.cause === "deadline" ? "deadline" : "provider-error");
      }
      if (modelOutcome.state === "failed") return synthesizeOrPartial("provider-error");
      const response: AssistantResponse = modelOutcome.value;
      dependencies.onDiagnostic?.({ kind: "model-response", response });

      // Do not let a completion that raced cancellation update the transcript.
      const afterModel = stopReason();
      if (afterModel) return synthesizeOrPartial(afterModel);
      messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
      if (response.toolCalls.length === 0) {
        return result(response.content, true);
      }

      const remainingToolCalls = dependencies.limits.maxToolCalls - toolCalls;
      const calls = response.toolCalls.slice(0, Math.max(0, remainingToolCalls));
      const reachedToolLimit = calls.length < response.toolCalls.length;
      const toolOutcomes = await dispatchBatch(calls);

      // Workers can finish in any order. Commit only after the whole started
      // batch has settled, and always in the provider's original call order.
      const afterBatch = stopReason();
      if (afterBatch) return synthesizeOrPartial(afterBatch);
      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index]!;
        const toolOutcome = toolOutcomes[index]!;
        if (toolOutcome.state === "aborted") {
          if (toolOutcome.cause === "caller") return synthesizeOrPartial("cancelled");
          if (toolOutcome.cause === "deadline") return synthesizeOrPartial("deadline");
          messages.push({
            role: "tool",
            name: call.name,
            toolCallId: call.id,
            content: "Tool error (timeout): Tool execution timed out."
          });
          continue;
        }
        if (toolOutcome.state === "failed") {
          messages.push({
            role: "tool",
            name: call.name,
            toolCallId: call.id,
            content: "Tool error (internal): Tool execution failed."
          });
          continue;
        }
        const result = toolOutcome.value;
        dependencies.onDiagnostic?.({ kind: "tool-result", call, result });
        duplicateOutcomes.record(call, result);
        if (result.status === "success") {
          const retained = evidenceCollector.retain({
            toolName: call.name,
            toolCallId: call.id,
            content: result.content,
            metadata: result.metadata,
            truncation: result.truncation
          });
          if (retained.evidence !== undefined) evidence.push(retained.evidence);
          messages.push({
            role: "tool",
            name: call.name,
            toolCallId: call.id,
            content: formatEvidenceToolMessage(retained)
          });
        } else {
          messages.push({
            role: "tool",
            name: call.name,
            toolCallId: call.id,
            content: `Tool error (${result.code}): ${result.message}`
          });
        }
      }
      // Complete the transcript for calls that could not be started. A final
      // synthesis provider must never receive unmatched assistant tool calls.
      for (const call of response.toolCalls.slice(calls.length)) {
        messages.push({
          role: "tool",
          name: call.name,
          toolCallId: call.id,
          content: "Tool error (tool-limit): Tool execution was not started because the tool-call limit was reached."
        });
      }
      if (reachedToolLimit) return synthesizeOrPartial("tool-limit");
      if (calls.length > 0 && toolOutcomes.every(isDuplicateOutcome)) return synthesizeOrPartial("duplicate-only");
    }

    return synthesizeOrPartial("model-limit");
  } finally {
    timers.clearTimeout(deadlineTimer);
  }

  function stopReason(): InvestigationResult["reason"] | undefined {
    if (signal.aborted) return "cancelled";
    if (deadlineController.signal.aborted || now() >= deadlineAt) return "deadline";
    return undefined;
  }

  async function runChild<T>(operation: (childSignal: AbortSignal) => Promise<T>, operationTimeoutMs: number): Promise<OperationOutcome<T>> {
    if (signal.aborted) return { state: "aborted", cause: "caller" };
    if (deadlineController.signal.aborted || now() >= deadlineAt) return { state: "aborted", cause: "deadline" };

    const controller = new AbortController();
    let cause: AbortCause | undefined;
    const abort = (nextCause: AbortCause): void => {
      if (!controller.signal.aborted) {
        cause = nextCause;
        controller.abort();
      }
    };
    const onCallerAbort = () => abort("caller");
    const onDeadlineAbort = () => abort("deadline");
    signal.addEventListener("abort", onCallerAbort, { once: true });
    deadlineController.signal.addEventListener("abort", onDeadlineAbort, { once: true });

    // The deadline controller owns the earlier deadline. A per-operation timer
    // is installed only when it can fire first, keeping its abort local.
    const remainingMs = Math.max(0, deadlineAt - now());
    const timeoutTimer = operationTimeoutMs < remainingMs ? timers.setTimeout(() => abort("operation-timeout"), operationTimeoutMs) : undefined;
    const aborted = new Promise<OperationOutcome<T>>((resolve) => {
      controller.signal.addEventListener("abort", () => resolve({ state: "aborted", cause: cause ?? "operation-timeout" }), { once: true });
    });
    const completion = Promise.resolve()
      .then(() => operation(controller.signal))
      .then(
        (value): OperationOutcome<T> => ({ state: "completed", value }),
        (): OperationOutcome<T> => ({ state: "failed" })
      );

    try {
      return await Promise.race([completion, aborted]);
    } finally {
      if (timeoutTimer !== undefined) timers.clearTimeout(timeoutTimer);
      signal.removeEventListener("abort", onCallerAbort);
      deadlineController.signal.removeEventListener("abort", onDeadlineAbort);
    }
  }

  async function dispatchBatch(calls: readonly ToolCall[]): Promise<OperationOutcome<ToolExecutionResult>[]> {
    const outcomes: OperationOutcome<ToolExecutionResult>[] = new Array(calls.length);
    const workerCount = Math.min(calls.length, Math.max(1, Math.floor(dependencies.limits.maxConcurrentToolCalls)));
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (stopReason()) return;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= calls.length) return;
        const call = calls[index]!;
        const duplicate = duplicateOutcomes.duplicateFor(call);
        if (duplicate !== undefined) {
          outcomes[index] = { state: "completed", value: duplicate };
          continue;
        }
        toolCalls += 1;
        outcomes[index] = await runChild((childSignal) => dependencies.registry.dispatch(call, childSignal), dependencies.limits.subprocessTimeoutMs);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return outcomes;
  }

  function partial(reason: InvestigationResult["reason"]): InvestigationResult {
    const evidenceIds = evidence.map((item) => item.id);
    return result(
      `Investigation incomplete (${reason}). Collected ${evidence.length} evidence item(s): ${evidenceIds.length === 0 ? "none" : evidenceIds.join(", ")}.`,
      false,
      reason
    );
  }

  function isDuplicateOutcome(outcome: OperationOutcome<ToolExecutionResult>): boolean {
    return outcome.state === "completed" && outcome.value.status === "error" && outcome.value.code === "duplicate";
  }

  async function synthesizeOrPartial(reason: InvestigationStopReason): Promise<InvestigationResult> {
    // Cancellation and deadline expiry make the reserved call unusable. Do not
    // replace the stop that brought us here with a later synthesis failure.
    if (modelCalls >= dependencies.limits.maxModelCalls || stopReason() !== undefined) return partial(reason);

    modelCalls += 1;
    const synthesis = await runChild((childSignal) => dependencies.provider.respond(messages, [], childSignal), dependencies.limits.modelTimeoutMs);
    if (synthesis.state !== "completed" || synthesis.value.toolCalls.length !== 0) return partial(reason);
    dependencies.onDiagnostic?.({ kind: "model-response", response: synthesis.value });

    // A completed response that raced a stop is not safe to present as final.
    if (stopReason() !== undefined) return partial(reason);
    return result(synthesis.value.content, true);
  }

  /** Builds every externally visible result from the retained-evidence authority. */
  function result(answer: string, complete: boolean, reason?: InvestigationStopReason): InvestigationResult {
    return {
      answer,
      evidence,
      complete,
      ...(reason === undefined ? {} : { reason }),
      citationValidation: validateCitations(
        answer,
        evidence.map((item) => item.id)
      )
    };
  }
}
