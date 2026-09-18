import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";
import { liveEvaluationCase } from "../live-evaluation/cases.js";
import { runLiveEvaluation } from "../live-evaluation/runner.js";
import { OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";

const enabled = process.env.RUN_LIVE_DOCKER_E2E === "1";

test("restart-loop live evaluation provisions Docker, investigates it, judges the answer, and cleans up", { skip: enabled ? false : "Set RUN_LIVE_DOCKER_E2E=1 to run Docker and provider evaluation." }, async () => {
  const config = loadConfig();
  const result = await runLiveEvaluation(liveEvaluationCase("restart-loop"), {
    provider: new OpenAiCompatibleProvider(config.provider)
  });

  assert.equal(result.investigation.complete, true);
  assert.deepEqual(result.investigation.citationValidation.invalidEvidenceIds, []);
  assert.equal(result.review.decision, "pass", result.review.rationale);
});
