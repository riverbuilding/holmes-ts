import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LIMITS, type AssistantMessage, type Evidence, ProviderError, type ToolError, type ToolSuccess, type Truncation } from "../core/types.js";

test("Phase 1 contracts represent a tool-call history, success evidence, and structured error", () => {
  const assistant: AssistantMessage = {
    role: "assistant",
    content: "I will inspect the exited container.",
    toolCalls: [{ id: "call_inspect_1", name: "docker_inspect", arguments: { container_or_image_id: "checkout" } }]
  };
  const truncation: Truncation = {
    truncated: true,
    reason: "character-limit",
    originalCharacterCount: 20_000,
    retainedCharacterCount: 16_000
  };
  const success: ToolSuccess = {
    status: "success",
    content: "ExitCode: 1",
    metadata: {
      resource: "container/checkout",
      collectedAt: "2026-09-09T12:00:00.000Z",
      toolCallId: "call_inspect_1",
      attributes: { state: "exited" }
    },
    truncation
  };
  const evidence: Evidence = {
    id: "E1",
    toolName: "docker_inspect",
    toolCallId: "call_inspect_1",
    content: success.content,
    metadata: success.metadata,
    truncation: success.truncation
  };
  const failure: ToolError = {
    status: "error",
    code: "not-found",
    message: "Container was not found.",
    retryable: false
  };

  assert.equal(assistant.toolCalls?.[0]?.id, evidence.toolCallId);
  assert.equal(evidence.truncation?.retainedCharacterCount, 16_000);
  assert.equal(failure.status, "error");
});

test("provider failures have stable, non-secret public fields", () => {
  const failure = new ProviderError("http", "Provider returned HTTP 429.", {
    status: 429,
    retryable: true
  });

  assert.equal(failure.name, "ProviderError");
  assert.equal(failure.code, "http");
  assert.equal(failure.options.status, 429);
  assert.equal(failure.options.retryable, true);
  assert.doesNotMatch(failure.message, /api[_ -]?key|bearer/i);
});

test("Phase 1 defaults enforce the planned investigation and evidence budgets", () => {
  assert.deepEqual(DEFAULT_LIMITS, {
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
  });
});
