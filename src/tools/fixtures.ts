import type { ToolDefinition } from "../core/types.js";

export type FixtureScenario = "missing-env" | "unavailable-image" | "insufficient-evidence";

/** Fixture tool implementations will use the same schemas as live Docker tools. */
export function createFixtureTools(_scenario: FixtureScenario): ToolDefinition[] {
  return [];
}
