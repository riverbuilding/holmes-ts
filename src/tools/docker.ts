import type { ToolRegistration } from "../core/types.js";

export interface DockerScope {
  context?: string;
}

/**
 * Tool construction belongs here. Milestone 3 will add read-only Docker tools:
 * list_containers, inspect_container, get_container_logs, and get_container_events.
 */
export function createDockerTools(_scope: DockerScope): ToolRegistration[] {
  return [];
}
