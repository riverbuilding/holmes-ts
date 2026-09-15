import type { DockerCommandResult, ToolRegistration } from "../core/types.js";
import { createDockerTools } from "./docker.js";
import { projectContainerRows, projectEvents, projectInspect, projectLogs } from "./docker-projection.js";

export type FixtureScenario = "missing-env" | "unavailable-image" | "insufficient-evidence";

export function createFixtureTools(scenario: FixtureScenario): ToolRegistration[] {
  return createDockerTools({}).map((tool) => {
    if (tool.name === "docker_ps" || tool.name === "docker_ps_all") {
      const all = tool.name === "docker_ps_all";
      return { ...tool, async execute(_arguments, _signal) { return projectContainerRows(fixtureCommand(scenario, all), "2026-09-15T00:00:00.000Z", 100); } };
    }
    if (tool.name === "docker_inspect") {
      return {
        ...tool,
        async execute(arguments_, _signal) {
          return projectInspect(fixtureInspectCommand(scenario, fixtureInspectResource(arguments_)), "2026-09-15T00:00:00.000Z");
        }
      };
    }
    if (tool.name === "docker_logs") {
      return {
        ...tool,
        async execute(arguments_, _signal) {
          return projectLogs(fixtureLogsCommand(scenario), "2026-09-15T00:00:00.000Z", fixtureLogTail(arguments_));
        }
      };
    }
    if (tool.name === "docker_events") {
      return {
        ...tool,
        async execute(arguments_, _signal) {
          return projectEvents(fixtureEventsCommand(scenario), "2026-09-15T00:00:00.000Z", fixtureEventLimit(arguments_));
        }
      };
    }
    return tool;
  });
}

function fixtureLogTail(arguments_: unknown): number {
  if (arguments_ !== null && typeof arguments_ === "object" && "tail" in arguments_ && typeof arguments_.tail === "number") return arguments_.tail;
  throw new Error("Invalid fixture logs arguments.");
}

function fixtureEventLimit(arguments_: unknown): number {
  if (arguments_ !== null && typeof arguments_ === "object" && "limit" in arguments_ && typeof arguments_.limit === "number") return arguments_.limit;
  throw new Error("Invalid fixture events arguments.");
}

function fixtureInspectResource(arguments_: unknown): string {
  if (arguments_ !== null && typeof arguments_ === "object" && "container_or_image_id" in arguments_ && typeof arguments_.container_or_image_id === "string") {
    return arguments_.container_or_image_id;
  }
  throw new Error("Invalid fixture inspect arguments.");
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

function fixtureInspectCommand(scenario: FixtureScenario, resource: string): DockerCommandResult {
  if (resource === "missing") {
    return { stdout: "", stderr: "Error response from daemon: No such object: missing", exitCode: 1, durationMs: 0, termination: "nonzero-exit", outputTruncated: false };
  }
  const document = scenario === "unavailable-image" ? imageInspectFixture() : containerInspectFixture(scenario);
  return { stdout: JSON.stringify([document]), stderr: "", exitCode: 0, durationMs: 0, termination: "completed", outputTruncated: false };
}

function fixtureLogsCommand(scenario: FixtureScenario): DockerCommandResult {
  const lines = scenario === "missing-env"
    ? ["2026-09-15T00:00:01.000000000Z configuration error: DATABASE_URL is required"]
    : scenario === "unavailable-image"
      ? []
      : ["2026-09-15T00:00:01.000000000Z service started"];
  return { stdout: lines.join("\n"), stderr: "", exitCode: 0, durationMs: 0, termination: "completed", outputTruncated: false };
}

function fixtureEventsCommand(scenario: FixtureScenario): DockerCommandResult {
  const rows = scenario === "missing-env"
    ? [{ timeNano: 1768435201000000000, Type: "container", Action: "die", Actor: { ID: "checkout-api", Attributes: { name: "checkout-api", image: "checkout:1.4" } } }]
    : scenario === "unavailable-image"
      ? []
      : [{ timeNano: 1768435201000000000, Type: "container", Action: "start", Actor: { ID: "checkout-api", Attributes: { name: "checkout-api", image: "checkout:latest" } } }];
  return { stdout: rows.map((row) => JSON.stringify(row)).join("\n"), stderr: "", exitCode: 0, durationMs: 0, termination: "completed", outputTruncated: false };
}

function containerInspectFixture(scenario: Exclude<FixtureScenario, "unavailable-image">): Record<string, unknown> {
  return {
    Id: "checkout-api", Name: "/checkout-api", Created: "2026-09-15T00:00:00.000Z",
    State: { Status: scenario === "missing-env" ? "exited" : "running", ExitCode: scenario === "missing-env" ? 1 : 0 },
    Config: { Image: "checkout:1.4", Env: ["DATABASE_URL=never-visible"], Labels: { service: "checkout", api_token: "never-visible" } }
  };
}

function imageInspectFixture(): Record<string, unknown> {
  return {
    Id: "sha256:checkout", RepoTags: ["checkout:1.4"], Created: "2026-09-15T00:00:00.000Z", Architecture: "amd64", Os: "linux",
    Config: { Cmd: ["node", "server.js"], Env: ["PASSWORD=never-visible"], Labels: { service: "checkout", password: "never-visible" } }
  };
}
