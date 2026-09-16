import { readFileSync } from "node:fs";
import type {
  DockerCommandResult,
  JsonObject,
  JsonValue,
  ToolRegistration
} from "../core/types.js";
import { createDockerTools } from "./docker.js";
import {
  projectContainerRows,
  projectEvents,
  projectInspect,
  projectLogs
} from "./docker-projection.js";

export type FixtureScenario =
  | "missing-env"
  | "unhealthy-container"
  | "insufficient-evidence";

interface FixtureObservations {
  readonly collectedAt: string;
  readonly containers: Readonly<{
    running: readonly JsonObject[];
    all: readonly JsonObject[];
  }>;
  readonly inspect: Readonly<Record<string, JsonObject>>;
  readonly logs: Readonly<Record<string, readonly string[]>>;
  readonly events: Readonly<Record<string, readonly JsonObject[]>>;
}

interface FixtureLogsArguments {
  readonly container_id: string;
  readonly tail: number;
}

interface FixtureEventsArguments {
  readonly container_id?: string;
  readonly limit: number;
}

export function createFixtureTools(
  scenario: FixtureScenario
): ToolRegistration[] {
  const observations = loadFixture(scenario);

  return createDockerTools({}).map((tool) => {
    if (tool.name === "docker_ps" || tool.name === "docker_ps_all") {
      const rows = tool.name === "docker_ps_all"
        ? observations.containers.all
        : observations.containers.running;

      return {
        ...tool,
        async execute(_arguments, _signal) {
          return projectContainerRows(
            completedJsonLines(rows),
            observations.collectedAt,
            100
          );
        }
      };
    }

    if (tool.name === "docker_inspect") {
      return {
        ...tool,
        async execute(arguments_, _signal) {
          const resource = fixtureInspectResource(arguments_);
          const document = observations.inspect[resource];
          const command = document === undefined
            ? missing(resource)
            : completed(JSON.stringify([document]));

          return projectInspect(command, observations.collectedAt);
        }
      };
    }

    if (tool.name === "docker_logs") {
      return {
        ...tool,
        async execute(arguments_, _signal) {
          const fixtureArguments = fixtureLogsArguments(arguments_);
          const lines = observations.logs[fixtureArguments.container_id];
          const command = lines === undefined
            ? missing(fixtureArguments.container_id)
            : completed(lines.join("\n"));

          return projectLogs(
            command,
            observations.collectedAt,
            fixtureArguments.tail
          );
        }
      };
    }

    if (tool.name === "docker_events") {
      return {
        ...tool,
        async execute(arguments_, _signal) {
          const fixtureArguments = fixtureEventsArguments(arguments_);
          const rows = fixtureArguments.container_id === undefined
            ? Object.values(observations.events).flat()
            : observations.events[fixtureArguments.container_id] ?? [];

          return projectEvents(
            completedJsonLines(rows),
            observations.collectedAt,
            fixtureArguments.limit
          );
        }
      };
    }

    return tool;
  });
}

function fixtureLogsArguments(arguments_: unknown): FixtureLogsArguments {
  if (
    isRecord(arguments_)
    && typeof arguments_.container_id === "string"
    && typeof arguments_.tail === "number"
  ) {
    return {
      container_id: arguments_.container_id,
      tail: arguments_.tail
    };
  }

  throw new Error("Invalid fixture logs arguments.");
}

function fixtureEventsArguments(
  arguments_: unknown
): FixtureEventsArguments {
  if (
    isRecord(arguments_)
    && typeof arguments_.limit === "number"
    && (
      arguments_.container_id === undefined
      || typeof arguments_.container_id === "string"
    )
  ) {
    return {
      ...(typeof arguments_.container_id === "string"
        ? { container_id: arguments_.container_id }
        : {}),
      limit: arguments_.limit
    };
  }

  throw new Error("Invalid fixture events arguments.");
}

function fixtureInspectResource(arguments_: unknown): string {
  if (
    isRecord(arguments_)
    && typeof arguments_.container_or_image_id === "string"
  ) {
    return arguments_.container_or_image_id;
  }

  throw new Error("Invalid fixture inspect arguments.");
}

function loadFixture(scenario: FixtureScenario): FixtureObservations {
  const filename = `${scenario}.v1.json`;
  let parsed: unknown;

  try {
    const fixtureUrl = new URL(`../../fixtures/${filename}`, import.meta.url);
    parsed = JSON.parse(readFileSync(fixtureUrl, "utf8"));
  } catch {
    throw new Error(`Fixture observations could not be loaded: ${filename}`);
  }

  return parseFixture(parsed, filename);
}

function parseFixture(
  value: unknown,
  filename: string
): FixtureObservations {
  if (
    !isRecord(value)
    || value.version !== 1
    || typeof value.collectedAt !== "string"
    || !isRecord(value.containers)
    || !isRecord(value.inspect)
    || !isRecord(value.logs)
    || !isRecord(value.events)
  ) {
    throw invalidFixture(filename);
  }

  const running = jsonObjectArray(value.containers.running);
  const all = jsonObjectArray(value.containers.all);
  const inspect = objectRecord(value.inspect);
  const logs = stringArrayRecord(value.logs);
  const events = objectArrayRecord(value.events);

  if (
    running === undefined
    || all === undefined
    || inspect === undefined
    || logs === undefined
    || events === undefined
    || !Number.isFinite(Date.parse(value.collectedAt))
  ) {
    throw invalidFixture(filename);
  }

  return {
    collectedAt: value.collectedAt,
    containers: { running, all },
    inspect,
    logs,
    events
  };
}

function completed(stdout: string): DockerCommandResult {
  return {
    stdout,
    stderr: "",
    exitCode: 0,
    durationMs: 0,
    termination: "completed",
    outputTruncated: false
  };
}

function completedJsonLines(
  rows: readonly JsonObject[]
): DockerCommandResult {
  return completed(rows.map((row) => JSON.stringify(row)).join("\n"));
}

function missing(resource: string): DockerCommandResult {
  return {
    stdout: "",
    stderr: `Error response from daemon: No such object: ${resource}`,
    exitCode: 1,
    durationMs: 0,
    termination: "nonzero-exit",
    outputTruncated: false
  };
}

function invalidFixture(filename: string): Error {
  return new Error(`Fixture observations are invalid: ${filename}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonValue(value: unknown): JsonValue | undefined {
  if (
    value === null
    || typeof value === "boolean"
    || typeof value === "string"
  ) {
    return value;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (Array.isArray(value)) {
    const entries = value.map(jsonValue);
    return entries.every((entry): entry is JsonValue => entry !== undefined)
      ? entries
      : undefined;
  }

  if (!isRecord(value)) return undefined;

  const result: JsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    const parsed = jsonValue(entry);
    if (parsed === undefined) return undefined;
    result[key] = parsed;
  }
  return result;
}

function jsonObject(value: unknown): JsonObject | undefined {
  const parsed = jsonValue(value);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : undefined;
}

function jsonObjectArray(value: unknown): JsonObject[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const values = value.map(jsonObject);
  return values.every((entry): entry is JsonObject => entry !== undefined)
    ? values
    : undefined;
}

function objectRecord(
  value: Record<string, unknown>
): Record<string, JsonObject> | undefined {
  const result: Record<string, JsonObject> = {};

  for (const [key, entry] of Object.entries(value)) {
    const parsed = jsonObject(entry);
    if (parsed === undefined) return undefined;
    result[key] = parsed;
  }

  return result;
}

function stringArrayRecord(
  value: Record<string, unknown>
): Record<string, readonly string[]> | undefined {
  const result: Record<string, readonly string[]> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (
      !Array.isArray(entry)
      || !entry.every((line): line is string => typeof line === "string")
    ) {
      return undefined;
    }
    result[key] = entry;
  }

  return result;
}

function objectArrayRecord(
  value: Record<string, unknown>
): Record<string, readonly JsonObject[]> | undefined {
  const result: Record<string, readonly JsonObject[]> = {};

  for (const [key, entry] of Object.entries(value)) {
    const parsed = jsonObjectArray(entry);
    if (parsed === undefined) return undefined;
    result[key] = parsed;
  }

  return result;
}
