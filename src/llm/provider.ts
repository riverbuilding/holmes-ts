import type { AssistantResponse, Message, ToolDefinition } from "../core/types.js";

/**
 * Provider boundary used by the investigation engine. Implementations must
 * reject with ProviderError and honor the supplied signal.
 */
export interface LlmProvider {
  respond(messages: readonly Message[], tools: readonly ToolDefinition[], signal: AbortSignal): Promise<AssistantResponse>;
}

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}
