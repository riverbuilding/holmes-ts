import assert from "node:assert/strict";
import test from "node:test";
import { loadLiveEvaluationCases } from "../live-evaluation/cases.js";

test("live evaluation loader reads the restart-loop case from its HolmesGPT-style directory", () => {
  assert.deepEqual(loadLiveEvaluationCases().map((testCase) => testCase.id), ["restart-loop"]);
  const testCase = loadLiveEvaluationCases()[0];
  assert.equal(testCase?.userPrompt.includes("holmes-e2e-restart-loop"), true);
  assert.equal(testCase?.expectedOutput.length, 3);
  assert.deepEqual(testCase?.tags, ["docker", "e2e"]);
});
