import type {
  AssistantResponse,
  Evidence,
  InvestigationLimits,
  InvestigationResult,
  Message,
  ToolDefinition
} from "./types.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { LlmProvider } from "../llm/provider.js";

export interface InvestigationDependencies {
  provider: LlmProvider;
  registry: ToolRegistry;
  systemPrompt: string;
  limits: InvestigationLimits;
  now?: () => number;
  timers?: InvestigationTimers;
}

/** Injectable timer boundary for deterministic deadline and timeout tests. */
export interface InvestigationTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

type AbortCause = "caller" | "deadline" | "operation-timeout";

type OperationOutcome<T> =
  | { state: "completed"; value: T }
  | { state: "failed" }
  | { state: "aborted"; cause: AbortCause };

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
  let modelCalls = 0;
  let toolCalls = 0;

  try {
    while (modelCalls < dependencies.limits.maxModelCalls) {
      const stopped = stopReason();
      if (stopped) return partial(stopped);

      modelCalls += 1;
      const modelOutcome = await runChild(
        (childSignal) => dependencies.provider.respond(messages, dependencies.registry.list(), childSignal),
        dependencies.limits.modelTimeoutMs
      );
      if (modelOutcome.state === "aborted") {
        return partial(modelOutcome.cause === "caller" ? "cancelled" : modelOutcome.cause === "deadline" ? "deadline" : "provider-error");
      }
      if (modelOutcome.state === "failed") return partial("provider-error");
      const response: AssistantResponse = modelOutcome.value;

      // Do not let a completion that raced cancellation update the transcript.
      const afterModel = stopReason();
      if (afterModel) return partial(afterModel);
      messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
      if (response.toolCalls.length === 0) {
        return { answer: response.content, evidence, complete: true };
      }

      for (const call of response.toolCalls) {
        const beforeTool = stopReason();
        if (beforeTool) return partial(beforeTool);
        if (toolCalls >= dependencies.limits.maxToolCalls) return partial("tool-limit");
        toolCalls += 1;
        const toolOutcome = await runChild(
          (childSignal) => dependencies.registry.dispatch(call, childSignal),
          dependencies.limits.subprocessTimeoutMs
        );
        if (toolOutcome.state === "aborted") {
          if (toolOutcome.cause === "caller") return partial("cancelled");
          if (toolOutcome.cause === "deadline") return partial("deadline");
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
        const afterTool = stopReason();
        if (afterTool) return partial(afterTool);
        if (result.status === "success") {
          const item: Evidence = {
            id: `E${evidence.length + 1}`,
            toolName: call.name,
            toolCallId: call.id,
            content: result.content,
            metadata: { ...result.metadata, toolCallId: call.id },
            truncation: result.truncation
          };
          evidence.push(item);
          messages.push({ role: "tool", name: call.name, toolCallId: call.id, content: `[${item.id}] ${item.content}` });
        } else {
          messages.push({
            role: "tool",
            name: call.name,
            toolCallId: call.id,
            content: `Tool error (${result.code}): ${result.message}`
          });
        }
      }
    }

    return partial("model-limit");
  } finally {
    timers.clearTimeout(deadlineTimer);
  }

  function stopReason(): InvestigationResult["reason"] | undefined {
    if (signal.aborted) return "cancelled";
    if (deadlineController.signal.aborted || now() >= deadlineAt) return "deadline";
    return undefined;
  }

  async function runChild<T>(
    operation: (childSignal: AbortSignal) => Promise<T>,
    operationTimeoutMs: number
  ): Promise<OperationOutcome<T>> {
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
    const timeoutTimer = operationTimeoutMs < remainingMs
      ? timers.setTimeout(() => abort("operation-timeout"), operationTimeoutMs)
      : undefined;
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

  function partial(reason: InvestigationResult["reason"]): InvestigationResult {
    return {
      answer: `Investigation incomplete (${reason}). Collected ${evidence.length} evidence item(s).`,
      evidence,
      complete: false,
      reason
    };
  }
}
