import {
  DEFAULT_LIMITS,
  ProviderError,
  type AssistantResponse,
  type JsonObject,
  type Message,
  type TokenUsage,
  type ToolCall,
  type ToolDefinition
} from "../core/types.js";
import type { LlmProvider, ProviderConfig } from "./provider.js";

const CHAT_COMPLETIONS_PATH = "v1/chat/completions";

/** HTTP adapter for the pinned OpenAI-compatible Chat Completions contract. */
export class OpenAiCompatibleProvider implements LlmProvider {
  public constructor(private readonly config: ProviderConfig) {}

  public async respond(messages: readonly Message[], tools: readonly ToolDefinition[], signal: AbortSignal): Promise<AssistantResponse> {
    const timeoutMs = this.config.modelTimeoutMs ?? DEFAULT_LIMITS.modelTimeoutMs;
    const timeoutController = new AbortController();
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    const combinedSignal = AbortSignal.any([signal, timeoutController.signal]);

    try {
      const response = await fetch(chatCompletionsUrl(this.config.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(toWireMessage),
          tools: tools.map((tool) => ({ type: "function", function: tool }))
        }),
        signal: combinedSignal
      });

      if (!response.ok) {
        throw new ProviderError("http", `Provider returned HTTP ${response.status}.`, {
          status: response.status,
          retryable: response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500
        });
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw invalidResponse("Provider returned invalid JSON.");
      }
      return parseResponse(payload);
    } catch (error: unknown) {
      if (error instanceof ProviderError) throw error;
      if (signal.aborted) {
        throw new ProviderError("cancelled", "Provider request was cancelled.", { retryable: false });
      }
      if (timeoutController.signal.aborted) {
        throw new ProviderError("timeout", "Provider request timed out.", { retryable: true });
      }
      throw new ProviderError("transport", "Provider request failed.", { retryable: true });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function chatCompletionsUrl(baseUrl: string | undefined): string {
  const normalized = (baseUrl?.trim() || "https://api.openai.com").replace(/\/+$/, "");
  const path = /\/v1$/i.test(normalized) ? "chat/completions" : CHAT_COMPLETIONS_PATH;
  return `${normalized}/${path}`;
}

function toWireMessage(message: Message): JsonObject {
  switch (message.role) {
    case "system":
    case "user":
      return { role: message.role, content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls === undefined ? {} : { tool_calls: message.toolCalls.map(toWireToolCall) })
      };
    case "tool":
      return { role: "tool", content: message.content, name: message.name, tool_call_id: message.toolCallId };
  }
}

function toWireToolCall(call: ToolCall): JsonObject {
  return { type: "function", id: call.id, function: { name: call.name, arguments: JSON.stringify(call.arguments) } };
}

function parseResponse(payload: unknown): AssistantResponse {
  const root = object(payload);
  const choices = root?.choices;
  if (!Array.isArray(choices) || choices.length === 0) throw invalidResponse("Provider response has no choices.");
  const choice = object(choices[0]);
  const message = object(choice?.message);
  if (!message) throw invalidResponse("Provider response has no assistant message.");
  if (typeof message.content !== "string" && message.content !== null && message.content !== undefined) {
    throw invalidResponse("Provider assistant content is invalid.");
  }
  if (message.tool_calls !== undefined && !Array.isArray(message.tool_calls)) {
    throw invalidResponse("Provider tool calls are invalid.");
  }
  const usage = parseUsage(root?.usage);
  return {
    content: typeof message.content === "string" ? message.content : "",
    toolCalls: (message.tool_calls ?? []).map(parseToolCall),
    ...(usage === undefined ? {} : { usage })
  };
}

function parseUsage(value: unknown): TokenUsage | undefined {
  const usage = object(value);
  if (usage === undefined || !isTokenCount(usage.prompt_tokens) || !isTokenCount(usage.completion_tokens) || !isTokenCount(usage.total_tokens)) {
    return undefined;
  }
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens
  };
}

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseToolCall(value: unknown): ToolCall {
  const call = object(value);
  const function_ = object(call?.function);
  if (!call || typeof call.id !== "string" || call.id.length === 0 || !function_ || typeof function_.name !== "string" || function_.name.length === 0) {
    throw invalidResponse("Provider tool call is missing an identifier or function name.");
  }
  // Keep malformed JSON as-is so the registry can produce its structured invalid-arguments result.
  const arguments_ = typeof function_.arguments === "string" ? parseArguments(function_.arguments) : function_.arguments;
  return { id: call.id, name: function_.name, arguments: arguments_ };
}

function parseArguments(arguments_: string): unknown {
  try {
    return JSON.parse(arguments_);
  } catch {
    return arguments_;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function invalidResponse(message: string): ProviderError {
  return new ProviderError("invalid-response", message, { retryable: false });
}
