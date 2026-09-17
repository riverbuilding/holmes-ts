import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { DEFAULT_LIMITS, type AssistantResponse, type InvestigationResult, type TokenUsage } from "../core/types.js";
import { investigate, type InvestigationDiagnostic } from "../core/investigate.js";
import type { LlmProvider } from "../llm/provider.js";
import { LOCAL_DOCKER_INVESTIGATION_SYSTEM_PROMPT } from "../prompts/local-docker-investigate.js";
import { createFixtureTools, type FixtureScenario } from "../tools/fixtures.js";
import { ToolRegistry } from "../tools/registry.js";
import { EVALUATION_SCENARIOS, type EvaluationScenario } from "./scenarios.js";

export type ReviewerDecision = "pass" | "fail" | "needs-review";
export type AutomaticGate = "pass" | "fail";

export interface EvaluationReview {
  readonly decision: ReviewerDecision;
  readonly rationale: string;
  readonly materialUnsupportedClaims: number;
}

export interface EvaluationRunSummary {
  readonly scenario: FixtureScenario;
  readonly run: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly elapsedMs: number;
  readonly model: string;
  readonly fixtureVersion: 2;
  readonly fixtureHash: string;
  readonly promptHash: string;
  readonly toolNames: readonly string[];
  readonly toolCount: number;
  readonly retainedEvidence: readonly { readonly id: string; readonly toolName: string }[];
  readonly complete: boolean;
  readonly reason?: InvestigationResult["reason"];
  readonly citations: InvestigationResult["citationValidation"];
  readonly usage: TokenUsage | "unavailable";
  readonly automaticGate: AutomaticGate;
  readonly review: EvaluationReview;
}

export interface EvaluationReport {
  readonly schemaVersion: 1;
  readonly model: string;
  readonly promptHash: string;
  readonly requestedRuns: number;
  readonly scenarios: readonly EvaluationScenario[];
  readonly runs: readonly EvaluationRunSummary[];
}

export interface EvaluationDependencies {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly now?: () => number;
  readonly createFixtureTools?: (scenario: FixtureScenario) => ReturnType<typeof createFixtureTools>;
  readonly review?: (result: InvestigationResult, scenario: EvaluationScenario) => EvaluationReview;
  readonly onDiagnostic?: (scenario: EvaluationScenario, run: number, event: InvestigationDiagnostic) => void;
}

/** Runs fixture-only evaluations; this module has no Docker CLI dependency. */
export async function runFixtureEvaluation(runCount: number, dependencies: EvaluationDependencies): Promise<EvaluationReport> {
  if (!Number.isSafeInteger(runCount) || runCount < 1) throw new Error("Evaluation run count must be a positive integer.");
  const now = dependencies.now ?? Date.now;
  const fixtureFactory = dependencies.createFixtureTools ?? createFixtureTools;
  const promptHash = sha256(LOCAL_DOCKER_INVESTIGATION_SYSTEM_PROMPT);
  const runs: EvaluationRunSummary[] = [];

  for (const scenario of EVALUATION_SCENARIOS) {
    const fixtureHash = fixtureSha256(scenario.id);
    for (let run = 1; run <= runCount; run += 1) {
      const registry = new ToolRegistry();
      for (const tool of fixtureFactory(scenario.id)) registry.register(tool);
      const provider = new UsageTrackingProvider(dependencies.provider);
      const started = now();
      const result = await investigate(scenario.question, {
        provider,
        registry,
        systemPrompt: LOCAL_DOCKER_INVESTIGATION_SYSTEM_PROMPT,
        limits: DEFAULT_LIMITS,
        ...(dependencies.onDiagnostic === undefined
          ? {}
          : { onDiagnostic: (event: InvestigationDiagnostic) => dependencies.onDiagnostic?.(scenario, run, event) })
      });
      const ended = now();
      const review = dependencies.review?.(result, scenario) ?? {
        decision: "needs-review",
        rationale: "Awaiting human review of the locally displayed answer.",
        materialUnsupportedClaims: 0
      };
      const gate = evaluateAutomaticGate(result, scenario, provider.toolNames, review);
      runs.push({
        scenario: scenario.id,
        run,
        startedAt: new Date(started).toISOString(),
        endedAt: new Date(ended).toISOString(),
        elapsedMs: Math.max(0, ended - started),
        model: dependencies.model,
        fixtureVersion: 2,
        fixtureHash,
        promptHash,
        toolNames: provider.toolNames,
        toolCount: provider.toolNames.length,
        retainedEvidence: result.evidence.map((evidence) => ({ id: evidence.id, toolName: evidence.toolName })),
        complete: result.complete,
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        citations: result.citationValidation,
        usage: aggregateUsage(provider.usages),
        automaticGate: gate,
        review: sanitizeReview(review)
      });
    }
  }
  return { schemaVersion: 1, model: safeValue(dependencies.model), promptHash, requestedRuns: runCount, scenarios: EVALUATION_SCENARIOS, runs };
}

function evaluateAutomaticGate(
  result: InvestigationResult,
  scenario: EvaluationScenario,
  toolNames: readonly string[],
  review: EvaluationReview
): AutomaticGate {
  const citations = result.citationValidation;
  const requiredToolsPresent = scenario.requiredTools.every((name) => toolNames.includes(name));
  return result.complete &&
    requiredToolsPresent &&
    citations.invalidEvidenceIds.length === 0 &&
    citations.duplicateEvidenceIds.length === 0 &&
    citations.malformedCitationTokens.length === 0 &&
    review.decision === "pass" &&
    review.materialUnsupportedClaims === 0
    ? "pass"
    : "fail";
}

class UsageTrackingProvider implements LlmProvider {
  public readonly usages: TokenUsage[] = [];
  public readonly toolNames: string[] = [];
  public constructor(private readonly provider: LlmProvider) {}

  public async respond(
    messages: Parameters<LlmProvider["respond"]>[0],
    tools: Parameters<LlmProvider["respond"]>[1],
    signal: AbortSignal
  ): Promise<AssistantResponse> {
    const response = await this.provider.respond(messages, tools, signal);
    if (response.usage !== undefined) this.usages.push(response.usage);
    this.toolNames.push(...response.toolCalls.map((call) => call.name));
    return response;
  }
}

function aggregateUsage(usages: readonly TokenUsage[]): TokenUsage | "unavailable" {
  if (usages.length === 0) return "unavailable";
  return usages.reduce(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      totalTokens: total.totalTokens + usage.totalTokens
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  );
}

function fixtureSha256(scenario: FixtureScenario): string {
  const fixture = new URL(`../../fixtures/${scenario}.v2.json`, import.meta.url);
  return sha256(readFileSync(fixture));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizeReview(review: EvaluationReview): EvaluationReview {
  if (
    (review.decision !== "pass" && review.decision !== "fail" && review.decision !== "needs-review") ||
    !Number.isSafeInteger(review.materialUnsupportedClaims) ||
    review.materialUnsupportedClaims < 0
  ) {
    throw new Error("Evaluation review is invalid.");
  }
  return {
    decision: review.decision,
    rationale: safeValue(review.rationale),
    materialUnsupportedClaims: review.materialUnsupportedClaims
  };
}

function safeValue(value: string): string {
  if (/\b(?:bearer\s+|sk-[A-Za-z0-9_-]{8,}|api[_ -]?key\s*[=:])/i.test(value)) {
    throw new Error("Evaluation reports cannot contain secret-like values.");
  }
  return value;
}

export function validateReportDestination(destination: string, workingDirectory: string = process.cwd()): string {
  const approved = resolve(workingDirectory, "docs/evaluations");
  const resolved = resolve(destination);
  const path = relative(approved, resolved);
  if (path === "" || path.startsWith("..") || path.includes("../")) {
    throw new Error("Evaluation report destination must be inside docs/evaluations.");
  }
  return resolved;
}

/** Deliberately excludes prompts, answers, raw evidence, and provider requests. */
export function serializeEvaluationReport(report: EvaluationReport): string {
  safeValue(report.model);
  for (const run of report.runs) {
    safeValue(run.model);
    safeValue(run.review.rationale);
  }
  return `${JSON.stringify(report, null, 2)}\n`;
}
