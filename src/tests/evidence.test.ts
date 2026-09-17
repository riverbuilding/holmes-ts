import assert from "node:assert/strict";
import test from "node:test";
import {
  EvidenceCollector,
  canonicalize,
  clipCharacters,
  extractCitations,
  extractMalformedCitationTokens,
  formatEvidenceToolMessage,
  redact,
  validateCitations
} from "../core/evidence.js";
import type { ToolResultMetadata, Truncation } from "../core/types.js";

test("canonicalize is deterministic for recursively reordered JSON objects", () => {
  const left = { z: [{ beta: 2, alpha: 1 }], a: { y: true, x: null } };
  const right = { a: { x: null, y: true }, z: [{ alpha: 1, beta: 2 }] };

  assert.equal(canonicalize(left), canonicalize(right));
  assert.equal(canonicalize(left), '{"a":{"x":null,"y":true},"z":[{"alpha":1,"beta":2}]}');
  assert.throws(() => canonicalize(Number.NaN), /non-finite/);
});

test("redaction is deterministic, longest-first, and does not alter the input", () => {
  const source = "short=abcd long=abcd-1234 again=abcd-1234";
  const result = redact(source, ["abcd", "abcd-1234", "", "abc"]);

  assert.equal(source, "short=abcd long=abcd-1234 again=abcd-1234");
  assert.equal(result.content, "short=[REDACTED] long=[REDACTED] again=[REDACTED]");
  assert.equal(result.redacted, true);
  assert.deepEqual(redact("value=abc", ["abc"]), { content: "value=abc", redacted: false });
});

test("clipCharacters reports exact retained and original character counts", () => {
  assert.deepEqual(clipCharacters("abcdef", 3), {
    content: "abc",
    truncation: { truncated: true, reason: "character-limit", originalCharacterCount: 6, retainedCharacterCount: 3 }
  });
  assert.deepEqual(clipCharacters("abc", 3), { content: "abc" });
  assert.throws(() => clipCharacters("abc", -1), /non-negative integer/);
});

test("collector redacts before clipping, preserves source truncation, and does not mutate metadata", () => {
  const collector = new EvidenceCollector({ maxCharsPerResult: 10, maxEvidenceChars: 20, knownSecrets: ["very-secret"] });
  const sourceTruncation: Truncation = {
    truncated: true,
    reason: "line-limit",
    originalItemCount: 5,
    retainedItemCount: 2
  };
  const metadata: ToolResultMetadata = {
    resource: "container/checkout",
    collectedAt: "2026-09-10T00:00:00.000Z",
    toolCallId: "wrong-call-id",
    attributes: { nested: { safe: true } }
  };
  const retained = collector.retain({
    toolName: "docker_logs",
    toolCallId: "call-1",
    content: "very-secret-abcdef",
    metadata,
    truncation: sourceTruncation
  });

  assert.equal(retained.evidence?.id, "E1");
  assert.equal(retained.evidence?.content, "[REDACTED]");
  assert.equal(retained.evidence?.metadata.toolCallId, "call-1");
  assert.deepEqual(retained.evidence?.truncation, sourceTruncation);
  assert.deepEqual(retained.evidence?.evidenceTruncations, [
    {
      truncated: true,
      reason: "character-limit",
      originalCharacterCount: 17,
      retainedCharacterCount: 10
    }
  ]);
  assert.equal(retained.redacted, true);
  assert.equal(metadata.toolCallId, "wrong-call-id");
  assert.deepEqual(metadata.attributes, { nested: { safe: true } });
});

test("collector clips each result, accounts for the total budget, and omits later content safely", () => {
  const collector = new EvidenceCollector({ maxCharsPerResult: 5, maxEvidenceChars: 7 });
  const first = collector.retain(evidenceInput("call-1", "abcdefgh"));
  const second = collector.retain(evidenceInput("call-2", "wxyz"));
  const third = collector.retain(evidenceInput("call-3", "later"));

  assert.equal(first.evidence?.content, "abcde");
  assert.deepEqual(first.evidence?.evidenceTruncations, [
    {
      truncated: true,
      reason: "character-limit",
      originalCharacterCount: 8,
      retainedCharacterCount: 5
    }
  ]);
  assert.equal(second.evidence?.id, "E2");
  assert.equal(second.evidence?.content, "wx");
  assert.deepEqual(second.evidence?.evidenceTruncations, [
    {
      truncated: true,
      reason: "evidence-budget",
      originalCharacterCount: 4,
      retainedCharacterCount: 2
    }
  ]);
  assert.equal(third.evidence, undefined);
  assert.equal(third.omitted, true);
  assert.equal(third.retainedContent, "");
  assert.equal(collector.remainingEvidenceCharacters, 0);
});

test("provider-visible evidence messages disclose safe retention indicators", () => {
  const collector = new EvidenceCollector({ maxCharsPerResult: 3, maxEvidenceChars: 3, knownSecrets: ["private-value"] });
  const retained = collector.retain(evidenceInput("call-1", "private-value-abcdef"));
  const omitted = collector.retain(evidenceInput("call-2", "xx"));

  assert.equal(formatEvidenceToolMessage(retained), "[E1] [RE (redacted; truncated: character-limit)");
  assert.equal(formatEvidenceToolMessage(omitted), "Observation omitted (truncated: evidence-budget).");
  assert.doesNotMatch(formatEvidenceToolMessage(retained), /private-value/);
});

test("citation extraction and validation retain order while rejecting unknown IDs", () => {
  const answer = "Observed [E2, E1]. Repeated [E2]; unknown [E9]. Ignore [not evidence].";

  assert.deepEqual(extractCitations(answer), ["E2", "E1", "E2", "E9"]);
  assert.deepEqual(validateCitations(answer, ["E1", "E2"]), {
    hasCitations: true,
    citedEvidenceIds: ["E2", "E1", "E2", "E9"],
    validEvidenceIds: ["E2", "E1"],
    invalidEvidenceIds: ["E9"],
    duplicateEvidenceIds: ["E2"],
    malformedCitationTokens: []
  });
  assert.deepEqual(validateCitations("No citations.", ["E1"]), {
    hasCitations: false,
    citedEvidenceIds: [],
    validEvidenceIds: [],
    invalidEvidenceIds: [],
    duplicateEvidenceIds: [],
    malformedCitationTokens: []
  });
});

test("citation validation exposes malformed evidence-shaped tokens without treating prose brackets as citations", () => {
  const answer = "Good [E1], malformed [E0], mixed [E2, Ebad, ], prose [not evidence].";

  assert.deepEqual(extractCitations(answer), ["E1", "E2"]);
  assert.deepEqual(extractMalformedCitationTokens(answer), ["E0", "Ebad", ""]);
  assert.deepEqual(validateCitations(answer, ["E1"]), {
    hasCitations: true,
    citedEvidenceIds: ["E1", "E2"],
    validEvidenceIds: ["E1"],
    invalidEvidenceIds: ["E2"],
    duplicateEvidenceIds: [],
    malformedCitationTokens: ["E0", "Ebad", ""]
  });
});

function evidenceInput(toolCallId: string, content: string) {
  return {
    toolName: "docker_logs",
    toolCallId,
    content,
    metadata: { resource: "container/checkout", collectedAt: "2026-09-10T00:00:00.000Z" }
  };
}
