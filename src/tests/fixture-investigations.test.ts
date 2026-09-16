import assert from "node:assert/strict";
import test from "node:test";
import { investigate } from "../core/investigate.js";
import type { AssistantResponse, Message, ToolDefinition } from "../core/types.js";
import type { LlmProvider } from "../llm/provider.js";
import { createFixtureTools, type FixtureScenario } from "../tools/fixtures.js";
import { ToolRegistry } from "../tools/registry.js";

test("missing-env fixture walks discovery, inspect, logs, and events through the registry", async () => {
  const result = await run("missing-env", [
    call("docker_ps_all", {}),
    call("docker_inspect", { container_or_image_id: "checkout-api" }),
    call("docker_logs", { container_id: "checkout-api", tail: 10 }),
    call("docker_events", eventArguments("checkout-api"))
  ], "checkout-api exited and its logs report that DATABASE_URL is required [E1] [E2] [E3] [E4].");

  assert.equal(result.result.complete, true);
  assert.deepEqual(result.calls, ["docker_ps_all", "docker_inspect", "docker_logs", "docker_events"]);
  assert.deepEqual(result.result.evidence.map((evidence) => evidence.toolName), result.calls);
  assert.deepEqual(result.result.citationValidation.invalidEvidenceIds, []);
  assert.match(result.result.answer, /DATABASE_URL is required/);
});

test("unhealthy-container fixture walks running discovery, inspect, events, and logs through the registry", async () => {
  const result = await run("unhealthy-container", [
    call("docker_ps", {}),
    call("docker_inspect", { container_or_image_id: "checkout-api" }),
    call("docker_events", eventArguments("checkout-api")),
    call("docker_logs", { container_id: "checkout-api", tail: 10 })
  ], "checkout-api is unhealthy; its health event and log show a failed dependency response [E1] [E2] [E3] [E4].");

  assert.equal(result.result.complete, true);
  assert.deepEqual(result.calls, ["docker_ps", "docker_inspect", "docker_events", "docker_logs"]);
  assert.deepEqual(result.result.evidence.map((evidence) => evidence.toolName), result.calls);
  assert.match(result.result.evidence[1]?.content ?? "", /unhealthy/);
  assert.deepEqual(result.result.citationValidation.invalidEvidenceIds, []);
});

test("insufficient-evidence fixture retains observations and does not turn missing logs into a root cause", async () => {
  const result = await run("insufficient-evidence", [
    call("docker_ps", {}),
    call("docker_inspect", { container_or_image_id: "checkout-api" }),
    call("docker_events", eventArguments("checkout-api")),
    call("docker_logs", { container_id: "missing", tail: 10 })
  ], "The container is running, but the empty event observation and missing logs do not establish a root cause [E1] [E2] [E3].");

  assert.equal(result.result.complete, true);
  assert.deepEqual(result.calls, ["docker_ps", "docker_inspect", "docker_events", "docker_logs"]);
  assert.deepEqual(result.result.evidence.map((evidence) => evidence.toolName), ["docker_ps", "docker_inspect", "docker_events"]);
  assert.doesNotMatch(result.result.answer, /because|caused by/i);
  assert.deepEqual(result.result.citationValidation.invalidEvidenceIds, []);
});

function call(name: string, arguments_: object): AssistantResponse {
  return { content: `Calling ${name}.`, toolCalls: [{ id: `call-${name}`, name, arguments: arguments_ }] };
}

function eventArguments(container_id: string): object {
  return { container_id, since: "2026-09-14T00:00:00Z", until: "2026-09-15T00:00:00Z", limit: 10 };
}

async function run(scenario: FixtureScenario, calls: readonly AssistantResponse[], answer: string): Promise<{ result: Awaited<ReturnType<typeof investigate>>; calls: string[] }> {
  const provider = new ScriptedProvider([...calls, { content: answer, toolCalls: [] }]);
  const registry = new ToolRegistry();
  for (const tool of createFixtureTools(scenario)) registry.register(tool);
  const result = await investigate("Investigate checkout.", {
    provider,
    registry,
    systemPrompt: "Investigate with the available Docker tools.",
    limits: { maxModelCalls: calls.length + 1, maxToolCalls: calls.length, deadlineMs: 1_000, modelTimeoutMs: 100, subprocessTimeoutMs: 100, maxConcurrentToolCalls: 1, maxLogLines: 100, maxRowsPerResult: 100, maxCharsPerResult: 1_000, maxEvidenceChars: 4_000 }
  });
  return { result, calls: provider.selected };
}

class ScriptedProvider implements LlmProvider {
  public readonly requests: Message[][] = [];
  public readonly selected: string[] = [];
  public constructor(private readonly responses: AssistantResponse[]) {}
  public async respond(messages: readonly Message[], _tools: readonly ToolDefinition[], _signal: AbortSignal): Promise<AssistantResponse> {
    this.requests.push([...structuredClone(messages)]);
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No scripted response remains.");
    this.selected.push(...response.toolCalls.map((toolCall) => toolCall.name));
    return response;
  }
}
