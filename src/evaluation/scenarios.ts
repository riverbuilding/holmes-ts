import type { FixtureScenario } from "../tools/fixtures.js";

export interface EvaluationScenario {
  readonly id: FixtureScenario;
  readonly question: string;
  readonly requiredTools: readonly string[];
  readonly conclusionCriterion: string;
}

export const EVALUATION_SCENARIOS: readonly EvaluationScenario[] = [
  {
    id: "missing-env",
    question: "Why did checkout exit? State the supported cause, safe next steps, and uncertainty.",
    requiredTools: ["docker_ps_all", "docker_inspect", "docker_logs"],
    conclusionCriterion: "Identify missing configuration only where state and logs support it."
  },
  {
    id: "unhealthy-container",
    question: "Why is checkout-api unhealthy? Separate the health symptom from the supported cause.",
    requiredTools: ["docker_ps", "docker_inspect", "docker_events", "docker_logs"],
    conclusionCriterion: "State the observed health state and only available dependency-failure evidence."
  },
  {
    id: "insufficient-evidence",
    question: "Can the root cause of checkout-api be established? State what is known and what is missing.",
    requiredTools: ["docker_ps", "docker_inspect", "docker_events", "docker_logs"],
    conclusionCriterion: "Do not manufacture a root cause; state missing evidence and a safe next observation."
  },
  {
    id: "image-regression",
    question: "What evidence is available for a checkout image regression, and what should be checked next?",
    requiredTools: ["docker_images", "docker_inspect", "docker_history"],
    conclusionCriterion: "Identify image and layer observations without claiming an unproven regression cause."
  },
  {
    id: "writable-layer-change",
    question: "What changed in checkout-api’s writable layer, and what can or cannot be concluded?",
    requiredTools: ["docker_ps", "docker_inspect", "docker_diff"],
    conclusionCriterion: "Distinguish observed paths from causal explanation and state a safe next check."
  }
];

export function evaluationScenario(id: FixtureScenario): EvaluationScenario {
  const scenario = EVALUATION_SCENARIOS.find((candidate) => candidate.id === id);
  if (scenario === undefined) throw new Error(`No evaluation scenario is defined for ${id}.`);
  return scenario;
}
