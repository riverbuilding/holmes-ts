import type { CitationValidation, Evidence, JsonObject, JsonValue, ToolResultMetadata, Truncation } from "./types.js";

const REDACTION_PLACEHOLDER = "[REDACTED]";
const MINIMUM_SECRET_LENGTH = 4;

export interface EvidenceCollectorOptions {
  maxCharsPerResult: number;
  maxEvidenceChars: number;
  knownSecrets?: Iterable<string>;
}

export interface EvidenceInput {
  toolName: string;
  toolCallId: string;
  content: string;
  metadata: ToolResultMetadata;
  truncation?: Truncation;
}

export interface ContentClip {
  content: string;
  truncation?: Truncation;
}

export interface RedactionResult {
  content: string;
  redacted: boolean;
}

export interface EvidenceRetention {
  evidence?: Evidence;
  retainedContent: string;
  omitted: boolean;
  redacted: boolean;
  /** A truncation reported by the tool before the collector handled content. */
  sourceTruncation?: Truncation;
  truncations: readonly Truncation[];
}

/**
 * Produces the only provider-visible representation of a retained tool
 * success. It deliberately consumes EvidenceRetention rather than raw tool
 * output, so callers cannot accidentally forward unredacted content.
 */
export function formatEvidenceToolMessage(retention: EvidenceRetention): string {
  const indicators = [
    ...(retention.redacted ? ["redacted"] : []),
    ...[retention.sourceTruncation, ...retention.truncations]
      .filter((truncation): truncation is Truncation => truncation !== undefined)
      .map((truncation) => `truncated: ${truncation.reason}`)
  ];
  const suffix = indicators.length === 0 ? "" : ` (${indicators.join("; ")})`;

  if (retention.evidence === undefined) return `Observation omitted${suffix || " (no evidence budget remaining)"}.`;
  return `[${retention.evidence.id}] ${retention.retainedContent}${suffix}`;
}

/**
 * Returns a stable JSON representation for JSON-compatible request arguments.
 * Object keys are sorted recursively; arrays retain their meaningful order.
 */
export function canonicalize(value: JsonValue): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Cannot canonicalize a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key]!)}`).join(",")}}`;
}

/** Replaces explicitly supplied, non-trivial secrets without mutating the source string. */
export function redact(content: string, knownSecrets: Iterable<string> = []): RedactionResult {
  const secrets = [...new Set([...knownSecrets].filter((secret) => secret.length >= MINIMUM_SECRET_LENGTH))]
    .sort((left, right) => right.length - left.length || (left < right ? -1 : left > right ? 1 : 0));
  let redactedContent = content;
  for (const secret of secrets) redactedContent = redactedContent.split(secret).join(REDACTION_PLACEHOLDER);
  return { content: redactedContent, redacted: redactedContent !== content };
}

/** Clips content by JavaScript string length and records the applied bound. */
export function clipCharacters(content: string, maxCharacters: number, reason: Truncation["reason"] = "character-limit"): ContentClip {
  assertCharacterLimit(maxCharacters, "maxCharacters");
  if (content.length <= maxCharacters) return { content };
  return {
    content: content.slice(0, maxCharacters),
    truncation: {
      truncated: true,
      reason,
      originalCharacterCount: content.length,
      retainedCharacterCount: maxCharacters
    }
  };
}

/** Extracts syntactically valid bracketed evidence references in their text order. */
export function extractCitations(answer: string): string[] {
  const citations: string[] = [];
  for (const match of answer.matchAll(/\[([^\]]+)\]/g)) {
    const ids = match[1]!.split(",").map((id) => id.trim());
    if (ids.length > 0 && ids.every((id) => /^E[1-9]\d*$/.test(id))) citations.push(...ids);
  }
  return citations;
}

/** Checks cited IDs against the retained-evidence authority without rewriting the answer. */
export function validateCitations(answer: string, knownEvidenceIds: Iterable<string>): CitationValidation {
  const known = new Set(knownEvidenceIds);
  const citedEvidenceIds = extractCitations(answer);
  const seen = new Set<string>();
  const duplicateEvidenceIds: string[] = [];
  const validEvidenceIds: string[] = [];
  const invalidEvidenceIds: string[] = [];

  for (const id of citedEvidenceIds) {
    if (seen.has(id)) {
      if (!duplicateEvidenceIds.includes(id)) duplicateEvidenceIds.push(id);
      continue;
    }
    seen.add(id);
    if (known.has(id)) validEvidenceIds.push(id);
    else invalidEvidenceIds.push(id);
  }

  return {
    hasCitations: citedEvidenceIds.length > 0,
    citedEvidenceIds,
    validEvidenceIds,
    invalidEvidenceIds,
    duplicateEvidenceIds
  };
}

/**
 * Owns deterministic evidence IDs and total retained-character accounting.
 * It never mutates the input result or exposes content that could not fit.
 */
export class EvidenceCollector {
  private readonly knownSecrets: readonly string[];
  private remainingCharacters: number;
  private nextEvidenceNumber = 1;

  public constructor(private readonly options: EvidenceCollectorOptions) {
    assertCharacterLimit(options.maxCharsPerResult, "maxCharsPerResult");
    assertCharacterLimit(options.maxEvidenceChars, "maxEvidenceChars");
    this.remainingCharacters = options.maxEvidenceChars;
    this.knownSecrets = [...(options.knownSecrets ?? [])];
  }

  public get remainingEvidenceCharacters(): number {
    return this.remainingCharacters;
  }

  public retain(input: EvidenceInput): EvidenceRetention {
    const redaction = redact(input.content, this.knownSecrets);
    const perResult = clipCharacters(redaction.content, this.options.maxCharsPerResult);
    const budgeted = clipCharacters(perResult.content, this.remainingCharacters, "evidence-budget");
    const truncations = [perResult.truncation, budgeted.truncation].filter((value): value is Truncation => value !== undefined);

    if (budgeted.content.length === 0) {
      return {
        evidence: undefined,
        retainedContent: "",
        omitted: true,
        redacted: redaction.redacted,
        ...(input.truncation === undefined ? {} : { sourceTruncation: structuredClone(input.truncation) }),
        truncations
      };
    }

    this.remainingCharacters -= budgeted.content.length;
    const metadata = cloneMetadata(input.metadata, input.toolCallId);
    const evidence: Evidence = {
      id: `E${this.nextEvidenceNumber++}`,
      toolName: input.toolName,
      toolCallId: input.toolCallId,
      content: budgeted.content,
      metadata,
      ...(input.truncation === undefined ? {} : { truncation: structuredClone(input.truncation) }),
      ...(truncations.length === 0 ? {} : { evidenceTruncations: truncations })
    };
    return {
      evidence,
      retainedContent: budgeted.content,
      omitted: false,
      redacted: redaction.redacted,
      ...(input.truncation === undefined ? {} : { sourceTruncation: structuredClone(input.truncation) }),
      truncations
    };
  }
}

function cloneMetadata(metadata: ToolResultMetadata, toolCallId: string): ToolResultMetadata {
  return {
    resource: metadata.resource,
    collectedAt: metadata.collectedAt,
    toolCallId,
    ...(metadata.attributes === undefined ? {} : { attributes: structuredClone(metadata.attributes) as JsonObject })
  };
}

function assertCharacterLimit(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer.`);
}
