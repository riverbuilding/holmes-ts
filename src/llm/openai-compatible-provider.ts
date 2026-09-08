import type { AssistantResponse, Message, ToolDefinition } from "../core/types.js";
import type { LlmProvider, ProviderConfig } from "./provider.js";

/**
 * Milestone 1 seam. The HTTP implementation belongs here once the selected
 * OpenAI-compatible endpoint and client library have been pinned.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  public constructor(private readonly config: ProviderConfig) {}

  public async respond(_messages: Message[], _tools: ToolDefinition[]): Promise<AssistantResponse> {
    void this.config;
    throw new Error("OpenAI-compatible provider is not implemented yet.");
  }
}
