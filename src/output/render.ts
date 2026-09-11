import type { InvestigationResult } from "../core/types.js";

export function renderResult(result: InvestigationResult): string {
  const status = result.complete ? "Investigation complete" : "Investigation incomplete";
  const evidence = result.evidence.length === 0
    ? "No evidence collected."
    : result.evidence.map((item) => `${item.id}: ${item.toolName} (${item.metadata.resource})`).join("\n");
  const validation = result.citationValidation;
  const warnings = [
    validation.invalidEvidenceIds.length > 0 ? `unknown evidence IDs: ${validation.invalidEvidenceIds.join(", ")}` : undefined,
    validation.duplicateEvidenceIds.length > 0 ? `duplicate evidence IDs: ${validation.duplicateEvidenceIds.join(", ")}` : undefined,
    validation.malformedCitationTokens.length > 0 ? `malformed citation tokens: ${validation.malformedCitationTokens.join(", ")}` : undefined
  ].filter((warning): warning is string => warning !== undefined);
  const citationWarning = warnings.length === 0 ? "" : `\n\nCitation warning: ${warnings.join("; ")}`;
  return `${status}\n\n${result.answer}${citationWarning}\n\nEvidence\n${evidence}`;
}
