export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface Message {
  role: MessageRole;
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ToolDefinition<TArguments = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  parseArguments(input: unknown): TArguments;
  execute(arguments_: TArguments, signal: AbortSignal): Promise<ToolExecutionResult>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface ToolExecutionResult {
  content: string;
  resource: string;
  collectedAt: string;
  truncated?: boolean;
}

export interface Evidence extends ToolExecutionResult {
  id: string;
  toolName: string;
}

export interface AssistantResponse {
  content: string;
  toolCalls: ToolCall[];
}

export interface InvestigationResult {
  answer: string;
  evidence: Evidence[];
  complete: boolean;
  reason?: "deadline" | "tool-limit" | "model-limit" | "cancelled" | "provider-error";
}

export interface InvestigationLimits {
  maxModelCalls: number;
  maxToolCalls: number;
  deadlineMs: number;
}

export const DEFAULT_LIMITS: InvestigationLimits = {
  maxModelCalls: 8,
  maxToolCalls: 12,
  deadlineMs: 120_000
};
