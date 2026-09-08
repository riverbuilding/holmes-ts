import type { InvestigationResult } from "../core/types.js";

export function renderResult(result: InvestigationResult): string {
  const status = result.complete ? "Investigation complete" : "Investigation incomplete";
  const evidence = result.evidence.length === 0
    ? "No evidence collected."
    : result.evidence.map((item) => `${item.id}: ${item.toolName} (${item.resource})`).join("\n");
  return `${status}\n\n${result.answer}\n\nEvidence\n${evidence}`;
}
