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
}

/**
 * Bounded model/tool loop. It is intentionally provider-agnostic so fixtures
 * and a live Docker backend can exercise the same investigation behavior.
 */
export async function investigate(
  question: string,
  dependencies: InvestigationDependencies,
  signal: AbortSignal = new AbortController().signal
): Promise<InvestigationResult> {
  const startedAt = (dependencies.now ?? Date.now)();
  const messages: Message[] = [
    { role: "system", content: dependencies.systemPrompt },
    { role: "user", content: question }
  ];
  const evidence: Evidence[] = [];
  let modelCalls = 0;
  let toolCalls = 0;

  while (modelCalls < dependencies.limits.maxModelCalls) {
    if (signal.aborted) return partial("cancelled");
    if ((dependencies.now ?? Date.now)() - startedAt >= dependencies.limits.deadlineMs) {
      return partial("deadline");
    }

    modelCalls += 1;
    let response: AssistantResponse;
    try {
      response = await dependencies.provider.respond(messages, dependencies.registry.list(), signal);
    } catch {
      return partial("provider-error");
    }

    messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });
    if (response.toolCalls.length === 0) {
      return { answer: response.content, evidence, complete: true };
    }

    for (const call of response.toolCalls) {
      if (toolCalls >= dependencies.limits.maxToolCalls) return partial("tool-limit");
      toolCalls += 1;
      const result = await dependencies.registry.dispatch(call, signal);
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

  function partial(reason: InvestigationResult["reason"]): InvestigationResult {
    return {
      answer: `Investigation incomplete (${reason}). Collected ${evidence.length} evidence item(s).`,
      evidence,
      complete: false,
      reason
    };
  }
}
