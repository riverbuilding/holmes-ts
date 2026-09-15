import type { DockerCommandResult, ToolRegistration } from "../core/types.js";
import { createDockerTools } from "./docker.js";
import { projectContainerRows } from "./docker-projection.js";

export type FixtureScenario = "missing-env" | "unavailable-image" | "insufficient-evidence";

export function createFixtureTools(scenario: FixtureScenario): ToolRegistration[] {
  return createDockerTools({}).map((tool) => {
    if (tool.name !== "docker_ps" && tool.name !== "docker_ps_all") return tool;
    const all = tool.name === "docker_ps_all";
    return {
      ...tool,
      async execute(_arguments, _signal) {
        return projectContainerRows(fixtureCommand(scenario, all), "2026-09-15T00:00:00.000Z", 100);
      }
    };
  });
}

function fixtureCommand(scenario: FixtureScenario, all: boolean): DockerCommandResult {
  const rows = fixtureRows(scenario, all);
  return { stdout: rows.map((row) => JSON.stringify(row)).join("\n"), stderr: "", exitCode: 0, durationMs: 0, termination: "completed", outputTruncated: false };
}

function fixtureRows(scenario: FixtureScenario, all: boolean): readonly Record<string, string>[] {
  switch (scenario) {
    case "missing-env": return all ? [
      { ID: "checkout-api", Names: "checkout-api", Image: "checkout:1.4", State: "exited", Status: "Exited (1) 2 minutes ago" },
      { ID: "checkout-db", Names: "checkout-db", Image: "postgres:16", State: "running", Status: "Up 10 minutes" }
    ] : [{ ID: "checkout-db", Names: "checkout-db", Image: "postgres:16", State: "running", Status: "Up 10 minutes" }];
    case "unavailable-image": return [];
    case "insufficient-evidence": return all ? [
      { ID: "checkout-api", Names: "checkout-api", Image: "checkout:latest", State: "running", Status: "Up 3 minutes" }
    ] : [{ ID: "checkout-api", Names: "checkout-api", Image: "checkout:latest", State: "running", Status: "Up 3 minutes" }];
  }
}
