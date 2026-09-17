import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantResponse, Message, ToolDefinition } from "../core/types.js";
import { parseEvaluationArguments } from "../evaluation/cli.js";
import { runFixtureEvaluation, serializeEvaluationReport, validateReportDestination, type EvaluationReview } from "../evaluation/runner.js";
import { EVALUATION_SCENARIOS } from "../evaluation/scenarios.js";
import type { LlmProvider } from "../llm/provider.js";
import { createFixtureTools, type FixtureScenario } from "../tools/fixtures.js";

test("fixture evaluator uses fixed scenarios, fixture tools, safe summaries, and available usage", async () => {
  let fixtureRegistries = 0;
  const clock = incrementingClock(1_700_000_000_000, 25);
  const report = await runFixtureEvaluation(1, {
    provider: new ScenarioProvider(),
    model: "fixture-model",
    now: clock,
    createFixtureTools(scenario) {
      fixtureRegistries += 1;
      return createFixtureTools(scenario);
    },
    review: passingReview
  });

  assert.equal(fixtureRegistries, EVALUATION_SCENARIOS.length);
  assert.equal(report.runs.length, EVALUATION_SCENARIOS.length);
  assert.deepEqual(
    report.runs.map((run) => run.scenario),
    EVALUATION_SCENARIOS.map((scenario) => scenario.id)
  );
  assert.ok(report.runs.every((run) => run.automaticGate === "pass"));
  assert.deepEqual(report.runs[0]?.usage, { inputTokens: 4, outputTokens: 4, totalTokens: 8 });
  assert.equal(report.runs[0]?.elapsedMs, 25);
  assert.equal(report.runs[0]?.fixtureVersion, 2);
  assert.equal(report.runs[0]?.toolCount, 3);
  assert.match(report.promptHash, /^[a-f0-9]{64}$/);
  assert.ok(report.runs.every((run) => /^[a-f0-9]{64}$/.test(run.fixtureHash)));
  assert.ok(report.runs.every((run) => run.retainedEvidence.every((evidence) => /^E\d+$/.test(evidence.id))));
  const serialized = serializeEvaluationReport(report);
  assert.doesNotMatch(serialized, /DATABASE_URL|Fixture conclusion/i);
});

test("evaluation gates reject invalid citations, incomplete results, missing required tools, and failed review", async () => {
  const invalid = await runFixtureEvaluation(1, { provider: new ScenarioProvider({ invalidCitation: true }), model: "fixture", review: passingReview });
  assert.equal(invalid.runs[0]?.automaticGate, "fail");

  const missingTool = await runFixtureEvaluation(1, { provider: new ScenarioProvider({ omitLastTool: true }), model: "fixture", review: passingReview });
  assert.equal(missingTool.runs[0]?.automaticGate, "fail");

  const failedReview = await runFixtureEvaluation(1, {
    provider: new ScenarioProvider(),
    model: "fixture",
    review: () => ({ decision: "fail", rationale: "Unsupported causal claim.", materialUnsupportedClaims: 1 })
  });
  assert.equal(failedReview.runs[0]?.automaticGate, "fail");

  const providerFailure = await runFixtureEvaluation(1, { provider: new FailingProvider(), model: "fixture", review: passingReview });
  assert.equal(providerFailure.runs[0]?.complete, false);
  assert.equal(providerFailure.runs[0]?.reason, "provider-error");
  assert.equal(providerFailure.runs[0]?.automaticGate, "fail");
  assert.equal(providerFailure.runs.length, EVALUATION_SCENARIOS.length);
});

test("evaluation command validates runs and report destinations before provider setup", () => {
  assert.equal(parseEvaluationArguments(["--report", "docs/evaluations/report.json"]).runs, 1);
  assert.throws(() => parseEvaluationArguments(["--runs", "0", "--report", "docs/evaluations/report.json"]), /positive integer/);
  assert.throws(() => parseEvaluationArguments(["--runs", "1", "--report", "outside.json"]), /inside docs\/evaluations/);
  assert.match(validateReportDestination("docs/evaluations/report.json"), /docs\/evaluations\/report\.json$/);
  assert.equal(parseEvaluationArguments(["--runs", "1", "--report", "docs/evaluations/report.json", "--verbose"]).verbose, true);
});

test("fixture evaluator exposes model and fixture-tool bodies only through its explicit diagnostic hook", async () => {
  const diagnostics: string[] = [];
  await runFixtureEvaluation(1, {
    provider: new ScenarioProvider(),
    model: "fixture",
    review: passingReview,
    onDiagnostic(scenario, run, event) {
      diagnostics.push(`${scenario.id}:${run}:${event.kind}`);
    }
  });

  assert.ok(diagnostics.some((entry) => entry === "missing-env:1:model-response"));
  assert.ok(diagnostics.some((entry) => entry === "missing-env:1:tool-result"));
});

test("report serialization rejects secret-like configured values", () => {
  assert.throws(
    () =>
      serializeEvaluationReport({
        schemaVersion: 1,
        model: "sk-secretvalue",
        promptHash: "hash",
        requestedRuns: 1,
        scenarios: [],
        runs: []
      }),
    /secret-like/
  );
});

function passingReview(): EvaluationReview {
  return { decision: "pass", rationale: "Supported by retained evidence.", materialUnsupportedClaims: 0 };
}

function incrementingClock(initial: number, increment: number): () => number {
  let value = initial;
  return () => {
    const current = value;
    value += increment;
    return current;
  };
}

class ScenarioProvider implements LlmProvider {
  public constructor(private readonly options: Readonly<{ invalidCitation?: boolean; omitLastTool?: boolean }> = {}) {}

  public async respond(messages: readonly Message[], _tools: readonly ToolDefinition[], _signal: AbortSignal): Promise<AssistantResponse> {
    const question = messages.find((message) => message.role === "user")?.content;
    const scenario = EVALUATION_SCENARIOS.find((candidate) => candidate.question === question);
    if (scenario === undefined) throw new Error("Scenario question was not fixed.");
    const selected = this.options.omitLastTool ? scenario.requiredTools.slice(0, -1) : scenario.requiredTools;
    const priorCalls = messages.filter((message) => message.role === "assistant").length;
    if (priorCalls < selected.length) {
      const name = selected[priorCalls]!;
      return {
        content: `Calling ${name}.`,
        toolCalls: [{ id: `${scenario.id}-${priorCalls}`, name, arguments: argumentsFor(name, scenario.id) }],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
      };
    }
    const citationCount = scenario.id === "insufficient-evidence" ? selected.length - 1 : selected.length;
    const citations = Array.from({ length: citationCount }, (_, index) => `[E${index + 1}]`).join(" ");
    return {
      content: `Fixture conclusion ${citations}${this.options.invalidCitation ? " [E999]" : ""}`,
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    };
  }
}

class FailingProvider implements LlmProvider {
  public async respond(_messages: readonly Message[], _tools: readonly ToolDefinition[], _signal: AbortSignal): Promise<AssistantResponse> {
    throw new Error("provider unavailable");
  }
}

function argumentsFor(name: string, scenario: FixtureScenario): object {
  switch (name) {
    case "docker_inspect":
      return { container_or_image_id: scenario === "image-regression" ? "checkout:1.5" : "checkout-api" };
    case "docker_logs":
      return { container_id: "checkout-api", tail: 10 };
    case "docker_events":
      return { container_id: "checkout-api", since: "2026-09-14T00:00:00Z", until: "2026-09-15T00:00:00Z", limit: 10 };
    case "docker_history":
      return { image_id: "checkout:1.5", limit: 10 };
    case "docker_diff":
      return { container_id: "checkout-api" };
    default:
      return {};
  }
}
