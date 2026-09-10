/** JSON-compatible values exchanged with an OpenAI-compatible provider. */
export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

/** An assistant turn, including the structured calls returned by the provider. */
export interface AssistantMessage {
  role: "assistant";
  content: string;
  toolCalls?: ToolCall[];
}

/** A result sent back to the provider for one specific assistant tool call. */
export interface ToolMessage {
  role: "tool";
  content: string;
  name: string;
  toolCallId: string;
}

export type Message = SystemMessage | UserMessage | AssistantMessage | ToolMessage;

/** The provider-facing, JSON-schema description of a registered tool. */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonObject;
}

/**
 * The executable part of a tool. Registrations are accepted only by
 * ToolRegistry; providers and the investigation loop see ToolDefinition only.
 */
export interface ToolRegistration<TArguments = unknown> extends ToolDefinition {
  parseArguments(input: unknown): TArguments;
  execute(arguments_: TArguments, signal: AbortSignal): Promise<ToolExecutionResult>;
}

/** A provider-assigned ID must be retained through the matching tool result. */
export interface ToolCall {
  /**
   * The non-empty identifier assigned by the provider for this call. It is
   * required because every subsequent tool result must refer to this ID.
   */
  id: string;
  name: string;
  arguments: unknown;
}

/**
 * Stable categories exposed by every model provider implementation. Error
 * messages must be safe to display and must never contain credentials.
 */
export type ProviderErrorCode = "timeout" | "cancelled" | "transport" | "invalid-response" | "http";

/** A normalized, non-secret failure returned by a model provider. */
export class ProviderError extends Error {
  public readonly name = "ProviderError";

  public constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly options: Readonly<{ status?: number; retryable: boolean }>
  ) {
    super(message);
  }
}

export interface Truncation {
  truncated: true;
  reason: "character-limit" | "row-limit" | "line-limit" | "evidence-budget" | "deadline";
  originalCharacterCount?: number;
  retainedCharacterCount?: number;
  originalItemCount?: number;
  retainedItemCount?: number;
}

export interface ToolResultMetadata {
  resource: string;
  collectedAt: string;
  /** Provider call ID that produced this observation, when available. */
  toolCallId?: string;
  /** Additional projected, JSON-safe observation metadata. */
  attributes?: JsonObject;
}

export interface ToolSuccess {
  status: "success";
  content: string;
  metadata: ToolResultMetadata;
  truncation?: Truncation;
}

export type ToolErrorCode =
  | "invalid-arguments"
  | "unknown-tool"
  | "not-found"
  | "unavailable"
  | "timeout"
  | "cancelled"
  | "nonzero-exit"
  | "malformed-output"
  | "duplicate"
  | "internal";

export interface ToolError {
  status: "error";
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  metadata?: ToolResultMetadata;
}

export type ToolExecutionResult = ToolSuccess | ToolError;

export interface Evidence {
  id: string;
  toolName: string;
  toolCallId: string;
  content: string;
  metadata: ToolResultMetadata;
  /** Truncation already applied by the tool that produced this observation. */
  truncation?: Truncation;
  /** Additional bounds applied while retaining the observation as evidence. */
  evidenceTruncations?: readonly Truncation[];
}

/** Citation references found in an answer, checked against retained evidence. */
export interface CitationValidation {
  hasCitations: boolean;
  citedEvidenceIds: readonly string[];
  validEvidenceIds: readonly string[];
  invalidEvidenceIds: readonly string[];
  duplicateEvidenceIds: readonly string[];
}

export interface AssistantResponse {
  content: string;
  toolCalls: ToolCall[];
}

export type InvestigationStopReason =
  | "deadline"
  | "tool-limit"
  | "model-limit"
  | "cancelled"
  | "provider-error";

export interface InvestigationResult {
  answer: string;
  evidence: Evidence[];
  complete: boolean;
  reason?: InvestigationStopReason;
  citationValidation?: CitationValidation;
}

export interface InvestigationLimits {
  maxModelCalls: number;
  maxToolCalls: number;
  deadlineMs: number;
  modelTimeoutMs: number;
  subprocessTimeoutMs: number;
  maxConcurrentToolCalls: number;
  maxLogLines: number;
  maxRowsPerResult: number;
  maxCharsPerResult: number;
  maxEvidenceChars: number;
}

export const DEFAULT_LIMITS: Readonly<InvestigationLimits> = {
  maxModelCalls: 12,
  maxToolCalls: 24,
  deadlineMs: 180_000,
  modelTimeoutMs: 30_000,
  subprocessTimeoutMs: 10_000,
  maxConcurrentToolCalls: 4,
  maxLogLines: 100,
  maxRowsPerResult: 100,
  maxCharsPerResult: 16_000,
  maxEvidenceChars: 96_000
};
