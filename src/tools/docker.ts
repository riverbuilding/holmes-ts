import { DEFAULT_LIMITS, type JsonObject, type ToolExecutionResult, type ToolRegistration } from "../core/types.js";
import type { DockerCli } from "./docker-cli.js";
import { projectContainerRows, projectDiffRows, projectEvents, projectImageHistory, projectImageRows, projectInspect, projectLogs, projectProcessRows } from "./docker-projection.js";
import { identifier, imageReference, objectShape, positiveBoundedInteger, timeWindow } from "./validation.js";

export interface DockerScope {
  context?: string;
  cli?: Pick<DockerCli, "execute">;
  commandTimeoutMs?: number;
  now?: () => number;
}
export interface DockerLogsArguments { container_id: string; tail: number; }
export interface DockerEventsArguments { container_id?: string; since: string; until: string; limit: number; }
export interface DockerHistoryArguments { image_id: string; limit: number; }

const MAX_ROWS = 100;
const MAX_LOG_LINES = 100;
const MAX_EVENT_WINDOW_MS = 24 * 60 * 60 * 1_000;

/**
 * Public Docker schemas adapted from HolmesGPT's docker/core toolset
 * (holmes/plugins/toolsets/docker.yaml, revision 5e983c17f30e93099c7d775167266d4cd1d586c4, Apache-2.0).
 */
export function createDockerTools(scope: DockerScope): ToolRegistration[] {
  return [
    dockerImagesTool(scope),
    containerDiscoveryTool("docker_ps", "List all running Docker containers", false, scope),
    containerDiscoveryTool("docker_ps_all", "List all Docker containers, including stopped ones", true, scope),
    dockerInspectTool(scope),
    dockerLogsTool(scope),
    dockerTopTool(scope),
    dockerEventsTool(scope),
    dockerHistoryTool(scope),
    dockerDiffTool(scope)
  ];
}

function containerDiscoveryTool(name: string, description: string, all: boolean, scope: DockerScope): ToolRegistration<Record<string, never>> {
  return {
    name, description, parameters: objectSchema({}), parseArguments(input) { objectShape(input, []); return {}; },
    async execute(_arguments, signal) {
      if (scope.context === undefined || scope.cli === undefined) return unavailable();
      const command = await scope.cli.execute(
        { kind: "container-ls", all },
        scope.context,
        signal,
        scope.commandTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs
      );
      return projectContainerRows(command, new Date().toISOString(), MAX_ROWS);
    }
  };
}

function dockerInspectTool(scope: DockerScope): ToolRegistration<{ container_or_image_id: string }> {
  return {
    name: "docker_inspect", description: "Inspect detailed information about a Docker container or image",
    parameters: objectSchema({ container_or_image_id: { type: "string", minLength: 1 } }, ["container_or_image_id"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["container_or_image_id"]);
      return { container_or_image_id: imageReference(arguments_.container_or_image_id, "container_or_image_id") };
    },
    async execute(arguments_, signal) {
      if (scope.context === undefined || scope.cli === undefined) return unavailable();
      const command = await scope.cli.execute(
        { kind: "inspect", resource: arguments_.container_or_image_id },
        scope.context,
        signal,
        scope.commandTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs
      );
      return projectInspect(command, new Date().toISOString());
    }
  };
}

function dockerImagesTool(scope: DockerScope): ToolRegistration<Record<string, never>> {
  return {
    name: "docker_images", description: "List all Docker images",
    parameters: objectSchema({}), parseArguments(input) { objectShape(input, []); return {}; },
    async execute(_arguments, signal) {
      if (scope.context === undefined || scope.cli === undefined) return unavailable();
      const command = await scope.cli.execute(
        { kind: "image-ls" },
        scope.context,
        signal,
        scope.commandTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs
      );
      return projectImageRows(command, new Date().toISOString(), MAX_ROWS);
    }
  };
}

function dockerTopTool(scope: DockerScope): ToolRegistration<{ container_id: string }> {
  return {
    name: "docker_top", description: "Display the running processes of a container",
    parameters: objectSchema({ container_id: { type: "string", minLength: 1 } }, ["container_id"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["container_id"]);
      return { container_id: identifier(arguments_.container_id, "container_id") };
    },
    async execute(arguments_, signal) {
      if (scope.context === undefined || scope.cli === undefined) return unavailable();
      const command = await scope.cli.execute(
        { kind: "container-top", container: arguments_.container_id },
        scope.context,
        signal,
        scope.commandTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs
      );
      return projectProcessRows(command, new Date().toISOString(), MAX_ROWS);
    }
  };
}

function resourceTool(name: string, description: string, field: "container_id" | "image_id" | "container_or_image_id"): ToolRegistration<Record<typeof field, string>> {
  return {
    name, description, parameters: objectSchema({ [field]: { type: "string", minLength: 1 } }, [field]),
    parseArguments(input) {
      const arguments_ = objectShape(input, [field]);
      return { [field]: field === "image_id" ? imageReference(arguments_[field], field) : identifier(arguments_[field], field) } as Record<typeof field, string>;
    },
    execute: unavailable
  };
}

function dockerLogsTool(scope: DockerScope): ToolRegistration<DockerLogsArguments> {
  return {
    name: "docker_logs", description: "Fetch the logs of a Docker container",
    parameters: objectSchema({ container_id: { type: "string", minLength: 1 }, tail: { type: "integer", minimum: 1, maximum: MAX_LOG_LINES, default: MAX_LOG_LINES } }, ["container_id"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["container_id", "tail"]);
      return { container_id: identifier(arguments_.container_id, "container_id"), tail: arguments_.tail === undefined ? MAX_LOG_LINES : positiveBoundedInteger(arguments_.tail, "tail", MAX_LOG_LINES) };
    },
    async execute(arguments_, signal) {
      if (scope.context === undefined || scope.cli === undefined) return unavailable();
      const command = await scope.cli.execute(
        { kind: "container-logs", container: arguments_.container_id, tail: arguments_.tail },
        scope.context,
        signal,
        scope.commandTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs
      );
      return projectLogs(command, new Date().toISOString(), arguments_.tail);
    }
  };
}

function dockerEventsTool(scope: DockerScope): ToolRegistration<DockerEventsArguments> {
  return {
    name: "docker_events", description: "Get historical events from the Docker server",
    parameters: objectSchema({ container_id: { type: "string", minLength: 1 }, since: { type: "string", format: "date-time" }, until: { type: "string", format: "date-time" }, limit: { type: "integer", minimum: 1, maximum: MAX_ROWS, default: MAX_ROWS } }, ["since", "until"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["container_id", "since", "until", "limit"]);
      const window = timeWindow(arguments_);
      if (!window.since || !window.until) throw new Error("since and until are required for historical events.");
      validateHistoricalEventWindow(window.since, window.until, scope.now ?? Date.now);
      return { ...(arguments_.container_id === undefined ? {} : { container_id: identifier(arguments_.container_id, "container_id") }), since: window.since, until: window.until, limit: arguments_.limit === undefined ? MAX_ROWS : positiveBoundedInteger(arguments_.limit, "limit", MAX_ROWS) };
    },
    async execute(arguments_, signal) {
      if (scope.context === undefined || scope.cli === undefined) return unavailable();
      const command = await scope.cli.execute(
        {
          kind: "events",
          since: arguments_.since,
          until: arguments_.until,
          ...(arguments_.container_id === undefined ? {} : { container: arguments_.container_id })
        },
        scope.context,
        signal,
        scope.commandTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs
      );
      return projectEvents(command, new Date().toISOString(), arguments_.limit);
    }
  };
}

function validateHistoricalEventWindow(since: string, until: string, now: () => number): void {
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);
  if (untilMs > now()) throw new Error("until must not be in the future for historical events.");
  if (untilMs - sinceMs > MAX_EVENT_WINDOW_MS) throw new Error("Event window must not exceed 24 hours.");
}

function dockerHistoryTool(scope: DockerScope): ToolRegistration<DockerHistoryArguments> {
  return {
    name: "docker_history", description: "Show the history of an image",
    parameters: objectSchema({ image_id: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: MAX_ROWS, default: MAX_ROWS } }, ["image_id"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["image_id", "limit"]);
      return { image_id: imageReference(arguments_.image_id, "image_id"), limit: arguments_.limit === undefined ? MAX_ROWS : positiveBoundedInteger(arguments_.limit, "limit", MAX_ROWS) };
    },
    async execute(arguments_, signal) {
      if (scope.context === undefined || scope.cli === undefined) return unavailable();
      const command = await scope.cli.execute(
        { kind: "image-history", image: arguments_.image_id },
        scope.context,
        signal,
        scope.commandTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs
      );
      return projectImageHistory(command, new Date().toISOString(), arguments_.limit);
    }
  };
}

function dockerDiffTool(scope: DockerScope): ToolRegistration<{ container_id: string }> {
  return {
    name: "docker_diff", description: "Inspect changes to files or directories on a container's filesystem",
    parameters: objectSchema({ container_id: { type: "string", minLength: 1 } }, ["container_id"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["container_id"]);
      return { container_id: identifier(arguments_.container_id, "container_id") };
    },
    async execute(arguments_, signal) {
      if (scope.context === undefined || scope.cli === undefined) return unavailable();
      const command = await scope.cli.execute(
        { kind: "container-diff", container: arguments_.container_id },
        scope.context,
        signal,
        scope.commandTimeoutMs ?? DEFAULT_LIMITS.subprocessTimeoutMs
      );
      return projectDiffRows(command, new Date().toISOString(), MAX_ROWS);
    }
  };
}

function objectSchema(properties: JsonObject, required: string[] = []): JsonObject { return { type: "object", additionalProperties: false, properties, required }; }
async function unavailable(): Promise<ToolExecutionResult> { return { status: "error", code: "unavailable", message: "Docker execution is not implemented yet.", retryable: false }; }
