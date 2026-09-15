import { DEFAULT_LIMITS, type JsonObject, type ToolExecutionResult, type ToolRegistration } from "../core/types.js";
import type { DockerCli } from "./docker-cli.js";
import { projectContainerRows } from "./docker-projection.js";
import { identifier, imageReference, objectShape, positiveBoundedInteger, timeWindow } from "./validation.js";

export interface DockerScope {
  context?: string;
  cli?: Pick<DockerCli, "execute">;
  commandTimeoutMs?: number;
}
export interface DockerLogsArguments { container_id: string; tail: number; }
export interface DockerEventsArguments { container_id?: string; since: string; until: string; limit: number; }
export interface DockerHistoryArguments { image_id: string; limit: number; }

const MAX_ROWS = 100;
const MAX_LOG_LINES = 100;

/**
 * Public Docker schemas adapted from HolmesGPT's docker/core toolset
 * (holmes/plugins/toolsets/docker.yaml, revision 5e983c17f30e93099c7d775167266d4cd1d586c4, Apache-2.0).
 */
export function createDockerTools(scope: DockerScope): ToolRegistration[] {
  return [
    noArgumentTool("docker_images", "List all Docker images"),
    containerDiscoveryTool("docker_ps", "List all running Docker containers", false, scope),
    containerDiscoveryTool("docker_ps_all", "List all Docker containers, including stopped ones", true, scope),
    resourceTool("docker_inspect", "Inspect detailed information about a Docker container or image", "container_or_image_id"),
    dockerLogsTool(),
    resourceTool("docker_top", "Display the running processes of a container", "container_id"),
    dockerEventsTool(),
    dockerHistoryTool(),
    resourceTool("docker_diff", "Inspect changes to files or directories on a container's filesystem", "container_id")
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

function noArgumentTool(name: string, description: string): ToolRegistration<Record<string, never>> {
  return { name, description, parameters: objectSchema({}), parseArguments(input) { objectShape(input, []); return {}; }, execute: unavailable };
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

function dockerLogsTool(): ToolRegistration<DockerLogsArguments> {
  return {
    name: "docker_logs", description: "Fetch the logs of a Docker container",
    parameters: objectSchema({ container_id: { type: "string", minLength: 1 }, tail: { type: "integer", minimum: 1, maximum: MAX_LOG_LINES, default: MAX_LOG_LINES } }, ["container_id"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["container_id", "tail"]);
      return { container_id: identifier(arguments_.container_id, "container_id"), tail: arguments_.tail === undefined ? MAX_LOG_LINES : positiveBoundedInteger(arguments_.tail, "tail", MAX_LOG_LINES) };
    }, execute: unavailable
  };
}

function dockerEventsTool(): ToolRegistration<DockerEventsArguments> {
  return {
    name: "docker_events", description: "Get historical events from the Docker server",
    parameters: objectSchema({ container_id: { type: "string", minLength: 1 }, since: { type: "string", format: "date-time" }, until: { type: "string", format: "date-time" }, limit: { type: "integer", minimum: 1, maximum: MAX_ROWS, default: MAX_ROWS } }, ["since", "until"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["container_id", "since", "until", "limit"]);
      const window = timeWindow(arguments_);
      if (!window.since || !window.until) throw new Error("since and until are required for historical events.");
      return { ...(arguments_.container_id === undefined ? {} : { container_id: identifier(arguments_.container_id, "container_id") }), since: window.since, until: window.until, limit: arguments_.limit === undefined ? MAX_ROWS : positiveBoundedInteger(arguments_.limit, "limit", MAX_ROWS) };
    }, execute: unavailable
  };
}

function dockerHistoryTool(): ToolRegistration<DockerHistoryArguments> {
  return {
    name: "docker_history", description: "Show the history of an image",
    parameters: objectSchema({ image_id: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1, maximum: MAX_ROWS, default: MAX_ROWS } }, ["image_id"]),
    parseArguments(input) {
      const arguments_ = objectShape(input, ["image_id", "limit"]);
      return { image_id: imageReference(arguments_.image_id, "image_id"), limit: arguments_.limit === undefined ? MAX_ROWS : positiveBoundedInteger(arguments_.limit, "limit", MAX_ROWS) };
    }, execute: unavailable
  };
}

function objectSchema(properties: JsonObject, required: string[] = []): JsonObject { return { type: "object", additionalProperties: false, properties, required }; }
async function unavailable(): Promise<ToolExecutionResult> { return { status: "error", code: "unavailable", message: "Docker execution is not implemented yet.", retryable: false }; }
