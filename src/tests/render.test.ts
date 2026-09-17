import assert from "node:assert/strict";
import test from "node:test";
import { renderResult } from "../output/render.js";
import type { InvestigationResult, InvestigationStopReason } from "../core/types.js";

test("renders a complete canonical answer with retained evidence and truncation provenance", () => {
  const rendered = renderResult(
    result({
      answer: canonicalAnswer(),
      evidence: [
        evidence("E1", "docker_logs", "container/checkout-api"),
        evidence("E2", "docker_inspect", "container/checkout-api", "row-limit", "evidence-budget")
      ],
      citationValidation: citationValidation({ validEvidenceIds: ["E1", "E2"], citedEvidenceIds: ["E1", "E2"], hasCitations: true })
    })
  );

  assert.equal(
    rendered,
    `Status: complete

Finding
checkout-api needs DATABASE_URL. [E1]

Evidence
The logs and inspect observation support the missing setting. [E1] [E2]

Retained evidence
- E1 — docker_logs — container/checkout-api
- E2 — docker_inspect — container/checkout-api (truncated: row-limit, evidence-budget)

Validated citations
- E1
- E2

Next steps
Set the missing configuration and restart the container.

Uncertainty
The fixture does not establish why the setting was omitted.`
  );
});

test("renders every partial reason with a fixed safe status", () => {
  const expected: Readonly<Record<InvestigationStopReason, string>> = {
    deadline: "investigation deadline reached",
    "tool-limit": "tool-call limit reached",
    "model-limit": "model-call limit reached",
    "duplicate-only": "only duplicate tool requests remained",
    cancelled: "investigation cancelled",
    "provider-error": "model provider failed"
  };

  for (const [reason, label] of Object.entries(expected) as [InvestigationStopReason, string][]) {
    assert.equal(
      renderResult(result({ complete: false, reason, answer: "No final synthesis." })),
      `Status: partial — ${label}

Finding
No final synthesis.

Evidence
Not supplied by the model.

Retained evidence
No retained evidence.

Next steps
Not supplied by the model.

Uncertainty
Not supplied by the model.`
    );
  }
});

test("renders zero evidence without adding a citation warning", () => {
  assert.equal(
    renderResult(result({ answer: canonicalAnswerWithoutCitations(), evidence: [] })),
    `Status: complete

Finding
checkout-api needs DATABASE_URL.

Evidence
The logs and inspect observation support the missing setting.

Retained evidence
No retained evidence.

Next steps
Set the missing configuration and restart the container.

Uncertainty
The fixture does not establish why the setting was omitted.`
  );
});

test("renders every citation warning category in stable order", () => {
  assert.equal(
    renderResult(
      result({
        answer: "An unsupported answer.",
        evidence: [evidence("E1", "docker_logs", "container/checkout-api")],
        citationValidation: citationValidation({
          hasCitations: true,
          citedEvidenceIds: ["E1", "E9", "E1"],
          validEvidenceIds: ["E1"],
          invalidEvidenceIds: ["E9"],
          duplicateEvidenceIds: ["E1"],
          malformedCitationTokens: ["E0"]
        })
      })
    ),
    `Status: complete

Finding
An unsupported answer.

Evidence
Not supplied by the model.

Retained evidence
- E1 — docker_logs — container/checkout-api

Validated citations
- E1

Next steps
Not supplied by the model.

Uncertainty
Not supplied by the model.

Citation warnings
- Unknown evidence IDs: E9
- Duplicate evidence IDs: E1
- Malformed citation tokens: E0`
  );

  assert.match(
    renderResult(
      result({
        answer: "An uncited answer.",
        evidence: [evidence("E1", "docker_logs", "container/checkout-api")]
      })
    ),
    /Citation warnings\n- No evidence citations were supplied despite retained evidence\.$/
  );
});

test("falls back to the finding section without dropping malformed answer text", () => {
  for (const answer of [
    "Finding\nOnly one section.",
    "Finding\nFirst finding.\nFinding\nRepeated heading.\nEvidence\nEvidence.\nNext steps\nNext.\nUncertainty\nUnknown.",
    "Evidence\nOut of order.\nFinding\nFinding.\nNext steps\nNext.\nUncertainty\nUnknown.",
    "Summary\nAn unrecognized heading.\nFinding\nFinding.\nEvidence\nEvidence.\nNext steps\nNext.\nUncertainty\nUnknown.",
    "Finding\nFinding.\nEvidence\nEvidence.\nSummary\nAn unrecognized heading.\nNext steps\nNext.\nUncertainty\nUnknown."
  ]) {
    assert.equal(
      renderResult(result({ answer })),
      `Status: complete

Finding
${answer}

Evidence
Not supplied by the model.

Retained evidence
No retained evidence.

Next steps
Not supplied by the model.

Uncertainty
Not supplied by the model.`
    );
  }
});

function result(overrides: Partial<InvestigationResult> = {}): InvestigationResult {
  return {
    answer: "",
    evidence: [],
    complete: true,
    citationValidation: citationValidation(),
    ...overrides
  };
}

function evidence(
  id: string,
  toolName: string,
  resource: string,
  sourceReason?: "row-limit",
  evidenceReason?: "evidence-budget"
): InvestigationResult["evidence"][number] {
  return {
    id,
    toolName,
    toolCallId: `call-${id}`,
    content: "must not be rendered",
    metadata: { resource, collectedAt: "2026-09-16T00:00:00.000Z" },
    ...(sourceReason === undefined ? {} : { truncation: { truncated: true, reason: sourceReason } }),
    ...(evidenceReason === undefined ? {} : { evidenceTruncations: [{ truncated: true, reason: evidenceReason }] })
  };
}

function citationValidation(overrides: Partial<InvestigationResult["citationValidation"]> = {}): InvestigationResult["citationValidation"] {
  return {
    hasCitations: false,
    citedEvidenceIds: [],
    validEvidenceIds: [],
    invalidEvidenceIds: [],
    duplicateEvidenceIds: [],
    malformedCitationTokens: [],
    ...overrides
  };
}

function canonicalAnswer(): string {
  return `Finding
checkout-api needs DATABASE_URL. [E1]
Evidence
The logs and inspect observation support the missing setting. [E1] [E2]
Next steps
Set the missing configuration and restart the container.
Uncertainty
The fixture does not establish why the setting was omitted.`;
}

function canonicalAnswerWithoutCitations(): string {
  return `Finding
checkout-api needs DATABASE_URL.
Evidence
The logs and inspect observation support the missing setting.
Next steps
Set the missing configuration and restart the container.
Uncertainty
The fixture does not establish why the setting was omitted.`;
}
