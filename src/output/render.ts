import type { InvestigationResult, InvestigationStopReason, Truncation } from "../core/types.js";

const ANSWER_HEADINGS = ["Finding", "Evidence", "Next steps", "Uncertainty"] as const;

interface AnswerSections {
  readonly finding: string;
  readonly evidence: string;
  readonly nextSteps: string;
  readonly uncertainty: string;
}

export function renderResult(result: InvestigationResult): string {
  const sections = parseAnswerSections(result.answer);
  const status = result.complete ? "Status: complete" : `Status: partial — ${partialReasonLabel(result.reason)}`;
  const evidence =
    result.evidence.length === 0
      ? "No retained evidence."
      : result.evidence
          .map((item) => {
            const truncations = [item.truncation, ...(item.evidenceTruncations ?? [])]
              .filter((truncation): truncation is Truncation => truncation !== undefined)
              .map((truncation) => truncation.reason);
            const truncation = truncations.length === 0 ? "" : ` (truncated: ${truncations.join(", ")})`;
            return `- ${item.id} — ${item.toolName} — ${item.metadata.resource}${truncation}`;
          })
          .join("\n");
  const validation = result.citationValidation;
  const warnings = [
    validation.invalidEvidenceIds.length > 0 ? `- Unknown evidence IDs: ${validation.invalidEvidenceIds.join(", ")}` : undefined,
    validation.duplicateEvidenceIds.length > 0 ? `- Duplicate evidence IDs: ${validation.duplicateEvidenceIds.join(", ")}` : undefined,
    validation.malformedCitationTokens.length > 0 ? `- Malformed citation tokens: ${validation.malformedCitationTokens.join(", ")}` : undefined,
    !validation.hasCitations && result.evidence.length > 0 ? "- No evidence citations were supplied despite retained evidence." : undefined
  ].filter((warning): warning is string => warning !== undefined);
  const validatedCitations =
    validation.validEvidenceIds.length === 0 ? "" : `\n\nValidated citations\n${validation.validEvidenceIds.map((id) => `- ${id}`).join("\n")}`;
  const citationWarnings = warnings.length === 0 ? "" : `\n\nCitation warnings\n${warnings.join("\n")}`;

  return `${status}\n\nFinding\n${displaySection(sections.finding)}\n\nEvidence\n${displaySection(sections.evidence)}\n\nRetained evidence\n${evidence}${validatedCitations}\n\nNext steps\n${displaySection(sections.nextSteps)}\n\nUncertainty\n${displaySection(sections.uncertainty)}${citationWarnings}`;
}

function parseAnswerSections(answer: string): AnswerSections {
  const lines = answer.replaceAll("\r\n", "\n").split("\n");
  const indices = ANSWER_HEADINGS.map((heading) => lines.indexOf(heading));
  const canonicalHeadingCount = lines.filter((line) => ANSWER_HEADINGS.includes(line as (typeof ANSWER_HEADINGS)[number])).length;

  const hasUnexpectedHeading = lines.some((line) => isHeadingLike(line) && !ANSWER_HEADINGS.includes(line as (typeof ANSWER_HEADINGS)[number]));
  if (indices[0] !== 0 || canonicalHeadingCount !== ANSWER_HEADINGS.length || !isCanonicalOrder(indices) || hasUnexpectedHeading) {
    return { finding: answer, evidence: "", nextSteps: "", uncertainty: "" };
  }

  return {
    finding: lines.slice(indices[0] + 1, indices[1]).join("\n"),
    evidence: lines.slice(indices[1] + 1, indices[2]).join("\n"),
    nextSteps: lines.slice(indices[2] + 1, indices[3]).join("\n"),
    uncertainty: lines.slice(indices[3] + 1).join("\n")
  };
}

function isCanonicalOrder(indices: readonly number[]): boolean {
  return indices.every((index, position) => index >= 0 && (position === 0 || index > (indices[position - 1] ?? index)));
}

function isHeadingLike(line: string): boolean {
  return /^#{1,6}\s+\S/.test(line) || /^[A-Z][A-Za-z ]{0,39}$/.test(line);
}

function displaySection(section: string): string {
  return section.trim().length === 0 ? "Not supplied by the model." : section;
}

function partialReasonLabel(reason: InvestigationStopReason | undefined): string {
  if (reason === undefined) return "investigation stopped before completion";

  switch (reason) {
    case "deadline":
      return "investigation deadline reached";
    case "tool-limit":
      return "tool-call limit reached";
    case "model-limit":
      return "model-call limit reached";
    case "duplicate-only":
      return "only duplicate tool requests remained";
    case "cancelled":
      return "investigation cancelled";
    case "provider-error":
      return "model provider failed";
  }
}
