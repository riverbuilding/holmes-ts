import type { JsonObject } from "../core/types.js";

export class ToolValidationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ToolValidationError";
  }
}

export function objectShape(input: unknown, allowedKeys: readonly string[]): JsonObject {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ToolValidationError("Arguments must be an object.");
  }
  const value = input as JsonObject;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) throw new ToolValidationError(`Unknown argument: ${key}`);
  }
  return value;
}

export function identifier(value: unknown, field: string): string {
  return nonFlagString(value, field, "a non-empty identifier");
}

export function imageReference(value: unknown, field: string): string {
  const reference = nonFlagString(value, field, "an image reference");
  if (/\s/.test(reference)) throw new ToolValidationError(`${field} must not contain whitespace.`);
  return reference;
}

export function positiveBoundedInteger(value: unknown, field: string, maximum: number, minimum = 1): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new ToolValidationError(`${field} must be an integer from ${minimum} to ${maximum}.`);
  }
  return value as number;
}

export function timestamp(value: unknown, field: string): string {
  const parsed = nonFlagString(value, field, "an ISO-8601 timestamp");
  if (Number.isNaN(Date.parse(parsed))) throw new ToolValidationError(`${field} must be an ISO-8601 timestamp.`);
  return parsed;
}

export interface TimeWindow {
  since?: string;
  until?: string;
}

export function timeWindow(input: JsonObject, sinceField = "since", untilField = "until"): TimeWindow {
  const since = input[sinceField] === undefined ? undefined : timestamp(input[sinceField], sinceField);
  const until = input[untilField] === undefined ? undefined : timestamp(input[untilField], untilField);
  if (since && until && Date.parse(since) > Date.parse(until)) {
    throw new ToolValidationError(`${sinceField} must not be after ${untilField}.`);
  }
  return { since, until };
}

/** Reject values that Docker would interpret as command-line flags. */
export function rejectFlagLikeInput(value: unknown, field: string): void {
  if (typeof value === "string" && value.startsWith("-")) {
    throw new ToolValidationError(`${field} must not start with '-'.`);
  }
}

function nonFlagString(value: unknown, field: string, expected: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ToolValidationError(`${field} must be ${expected}.`);
  }
  rejectFlagLikeInput(value, field);
  return value;
}
