import assert from "node:assert/strict";
import test from "node:test";
import { investigate, type InvestigationTimers } from "../core/investigate.js";
import type { AssistantResponse, Message, ToolDefinition, ToolRegistration } from "../core/types.js";
import type { LlmProvider } from "../llm/provider.js";
import { ToolRegistry } from "../tools/registry.js";

test("the loop attaches evidence before accepting a final answer", async () => {
  const scriptedProvider = new ScriptedProvider([
    { content: "I will inspect the container.", toolCalls: [{ id: "call-1", name: "inspect_container", arguments: { name: "checkout" } }] },
    { content: "The container exited because APP_MODE is missing [E1].", toolCalls: [] }
  ]);
  const provider: LlmProvider = scriptedProvider;
  const tool: ToolRegistration<{ name: string }> = {
    name: "inspect_container",
    description: "Inspect a container.",
    parameters: {},
    parseArguments: (input) => input as { name: string },
    execute: async ({ name }) => ({
      status: "success",
      content: "APP_MODE is missing",
      metadata: { resource: `container/${name}`, collectedAt: "2026-09-08T00:00:00.000Z" }
    })
  };
  const registry = new ToolRegistry();
  registry.register(tool);
  const controller = new AbortController();
  const result = await investigate("Why did checkout exit?", {
    provider,
    registry,
    systemPrompt: "Investigate.",
    limits: {
      maxModelCalls: 3,
      maxToolCalls: 2,
      deadlineMs: 1_000,
      modelTimeoutMs: 100,
      subprocessTimeoutMs: 100,
      maxConcurrentToolCalls: 1,
      maxLogLines: 100,
      maxRowsPerResult: 100,
      maxCharsPerResult: 1_000,
      maxEvidenceChars: 2_000
    }
  }, controller.signal);

  assert.equal(result.complete, true);
  assert.equal(result.evidence[0]?.id, "E1");
  assert.match(result.answer, /E1/);
  assert.equal(scriptedProvider.signals.length, 2);
  assert.ok(scriptedProvider.signals.every((childSignal) => childSignal !== controller.signal));
  assert.ok(scriptedProvider.signals.every((childSignal) => !childSignal.aborted));
});

test("results expose deterministic citation validation against retained, not merely observed, evidence", async () => {
  const provider = new ScriptedProvider([
    {
      content: "Inspecting.",
      toolCalls: [
        { id: "call-1", name: "first", arguments: {} },
        { id: "call-2", name: "second", arguments: {} },
        { id: "call-3", name: "omitted", arguments: {} }
      ]
    },
    { content: "Supported [E2, E1]. Repeated [E2]. Omitted [E3]. Mixed [E1, E9]. Bad [E0].", toolCalls: [] }
  ]);
  const registry = new ToolRegistry();
  for (const name of ["first", "second", "omitted"]) {
    registry.register({
      name,
      description: name,
      parameters: {},
      parseArguments: (input) => input,
      execute: async () => ({ status: "success", content: name, metadata: { resource: name, collectedAt: "now" } })
    });
  }

  const result = await investigate("question", dependencies(provider, registry, {
    maxToolCalls: 3,
    maxConcurrentToolCalls: 3,
    maxEvidenceChars: 11
  }));

  assert.deepEqual(result.evidence.map((item) => item.id), ["E1", "E2"]);
  assert.deepEqual(result.citationValidation, {
    hasCitations: true,
    citedEvidenceIds: ["E2", "E1", "E2", "E3", "E1", "E9"],
    validEvidenceIds: ["E2", "E1"],
    invalidEvidenceIds: ["E3", "E9"],
    duplicateEvidenceIds: ["E2", "E1"],
    malformedCitationTokens: ["E0"]
  });
});

test("partial-path synthesis validates citations using only retained evidence", async () => {
  const provider = new ScriptedProvider([
    {
      content: "Inspecting.",
      toolCalls: [
        { id: "call-1", name: "inspect", arguments: {} },
        { id: "call-2", name: "inspect", arguments: {} }
      ]
    },
    { content: "Partial synthesis [E1] and [E2].", toolCalls: [] }
  ]);
  const result = await investigate("question", dependencies(provider, registryWithTool({
    name: "inspect",
    execute: async () => ({ status: "success", content: "retained", metadata: { resource: "inspect", collectedAt: "now" } })
  }), { maxModelCalls: 2, maxToolCalls: 1 }));

  assert.equal(result.complete, true);
  assert.deepEqual(result.citationValidation.validEvidenceIds, ["E1"]);
  assert.deepEqual(result.citationValidation.invalidEvidenceIds, ["E2"]);
});

test("caller cancellation propagates to the active derived child signal", async () => {
  let modelSignal: AbortSignal | undefined;
  let toolSignal: AbortSignal | undefined;
  let resolveToolStarted: (() => void) | undefined;
  const toolStarted = new Promise<void>((resolve) => { resolveToolStarted = resolve; });
  const provider: LlmProvider = {
    respond: async (_messages, _tools, signal) => {
      modelSignal = signal;
      return { content: "Inspecting.", toolCalls: [{ id: "call-1", name: "wait", arguments: {} }] };
    }
  };
  const registry = registryWithTool({
    name: "wait",
    execute: async (_arguments, signal) => {
      toolSignal = signal;
      resolveToolStarted?.();
      return await new Promise(() => undefined);
    }
  });
  const caller = new AbortController();
  const pending = investigate("question", dependencies(provider, registry), caller.signal);

  await toolStarted;
  caller.abort();
  const result = await pending;

  assert.equal(result.reason, "cancelled");
  assert.equal(result.complete, false);
  assert.match(result.answer, /Investigation incomplete \(cancelled\)\. Collected 0 evidence item\(s\): none\./);
  assert.notEqual(modelSignal, caller.signal);
  assert.notEqual(toolSignal, caller.signal);
  assert.equal(toolSignal?.aborted, true);
});

test("model timeout aborts only its child signal", async () => {
  const clock = new FakeClock();
  let modelSignal: AbortSignal | undefined;
  let requests = 0;
  const caller = new AbortController();
  const provider: LlmProvider = {
    respond: async (_messages, _tools, signal) => {
      requests += 1;
      if (requests === 1) {
        modelSignal = signal;
        return await new Promise(() => undefined);
      }
      return { content: "Synthesis after timeout.", toolCalls: [] };
    }
  };
  const pending = investigate("question", dependencies(provider, new ToolRegistry(), { modelTimeoutMs: 10, deadlineMs: 50, clock }), caller.signal);

  await tick();
  clock.advance(10);
  const result = await pending;

  assert.equal(result.complete, true);
  assert.equal(result.answer, "Synthesis after timeout.");
  assert.equal(modelSignal?.aborted, true);
  assert.equal(caller.signal.aborted, false);
});

test("reserves the last model call for empty-tools synthesis with ordered retained history", async () => {
  const provider = new ScriptedProvider([
    {
      content: "Inspecting.",
      toolCalls: [
        { id: "call-first", name: "first", arguments: {} },
        { id: "call-second", name: "second", arguments: {} }
      ]
    },
    { content: "Synthesis [E1] [E2].", toolCalls: [] }
  ]);
  const registry = new ToolRegistry();
  for (const name of ["first", "second"]) {
    registry.register({
      name,
      description: name,
      parameters: {},
      parseArguments: (input) => input,
      execute: async () => ({ status: "success", content: `${name} observation`, metadata: { resource: name, collectedAt: "now" } })
    });
  }

  const result = await investigate("question", dependencies(provider, registry, { maxModelCalls: 2, maxToolCalls: 2, maxConcurrentToolCalls: 2 }));

  assert.equal(result.complete, true);
  assert.equal(provider.requests.length, 2);
  assert.deepEqual(provider.requests[1]?.map((message) => message.role), ["system", "user", "assistant", "tool", "tool"]);
  assert.deepEqual(provider.requests[1]?.filter((message) => message.role === "tool").map((message) => (message as Extract<Message, { role: "tool" }>).toolCallId), ["call-first", "call-second"]);
  assert.deepEqual(provider.tools, [2, 0]);
  assert.deepEqual(result.evidence.map((item) => item.id), ["E1", "E2"]);
});

test("tools requested by final synthesis are never dispatched and yield a deterministic partial", async () => {
  let executions = 0;
  const provider = new ScriptedProvider([
    { content: "I should not be able to run this.", toolCalls: [{ id: "synthesis-call", name: "inspect", arguments: {} }] }
  ]);
  const result = await investigate("question", dependencies(provider, registryWithTool({
    name: "inspect",
    execute: async () => {
      executions += 1;
      return { status: "success", content: "unreachable", metadata: { resource: "inspect", collectedAt: "now" } };
    }
  }), { maxModelCalls: 1 }));

  assert.equal(executions, 0);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "model-limit");
  assert.match(result.answer, /Collected 0 evidence item\(s\): none\./);
  assert.deepEqual(provider.tools, [0]);
});

test("failed synthesis preserves the originating terminal reason", async () => {
  const cases: readonly {
    name: string;
    provider: LlmProvider;
    registry: ToolRegistry;
    overrides: Partial<{ maxModelCalls: number; maxToolCalls: number }>;
    reason: "model-limit" | "tool-limit" | "provider-error";
  }[] = [
    {
      name: "model limit",
      provider: { respond: async () => { throw new Error("synthesis failed"); } },
      registry: new ToolRegistry(),
      overrides: { maxModelCalls: 1 },
      reason: "model-limit"
    },
    {
      name: "tool limit",
      provider: new ScriptedProvider([
        { content: "Inspecting.", toolCalls: [{ id: "call-1", name: "inspect", arguments: {} }] }
      ]),
      registry: registryWithTool({ name: "inspect", execute: async () => ({ status: "success", content: "unreachable", metadata: { resource: "inspect", collectedAt: "now" } }) }),
      overrides: { maxModelCalls: 2, maxToolCalls: 0 },
      reason: "tool-limit"
    },
    {
      name: "provider failure",
      provider: { respond: async () => { throw new Error("provider failed"); } },
      registry: new ToolRegistry(),
      overrides: { maxModelCalls: 2 },
      reason: "provider-error"
    }
  ];

  for (const scenario of cases) {
    const result = await investigate("question", dependencies(scenario.provider, scenario.registry, scenario.overrides));
    assert.equal(result.complete, false, scenario.name);
    assert.equal(result.reason, scenario.reason, scenario.name);
    assert.match(result.answer, new RegExp(`Investigation incomplete \\(${scenario.reason}\\)\\.`), scenario.name);
  }
});

test("a duplicate-only turn synthesizes once and preserves its stop reason on failure", async () => {
  const provider = new ScriptedProvider([
    { content: "first", toolCalls: [{ id: "call-1", name: "inspect", arguments: { target: "api" } }] },
    { content: "second", toolCalls: [{ id: "call-2", name: "inspect", arguments: { target: "api" } }] },
    { content: "third", toolCalls: [{ id: "call-3", name: "inspect", arguments: { target: "api" } }] }
  ]);
  let executions = 0;
  const result = await investigate("question", dependencies(provider, registryWithTool({
    name: "inspect",
    execute: async () => {
      executions += 1;
      return { status: "success", content: "unchanged", metadata: { resource: "inspect", collectedAt: "now" } };
    }
  }), { maxModelCalls: 4, maxToolCalls: 3 }));

  assert.equal(executions, 2);
  assert.equal(provider.requests.length, 4);
  assert.deepEqual(provider.tools, [1, 1, 1, 0]);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "duplicate-only");
});

test("tool timeout aborts only its child and allows the next model call", async () => {
  const clock = new FakeClock();
  const toolSignals: AbortSignal[] = [];
  let resolveToolStarted: (() => void) | undefined;
  const toolStarted = new Promise<void>((resolve) => { resolveToolStarted = resolve; });
  const provider = new ScriptedProvider([
    { content: "Inspecting.", toolCalls: [{ id: "call-1", name: "wait", arguments: {} }] },
    { content: "The tool timed out.", toolCalls: [] }
  ]);
  const caller = new AbortController();
  const registry = registryWithTool({
    name: "wait",
    execute: async (_arguments, signal) => {
      toolSignals.push(signal);
      resolveToolStarted?.();
      return await new Promise(() => undefined);
    }
  });
  const pending = investigate("question", dependencies(provider, registry, { subprocessTimeoutMs: 10, deadlineMs: 50, clock }), caller.signal);

  await toolStarted;
  clock.advance(10);
  const result = await pending;

  assert.equal(result.complete, true);
  assert.equal(toolSignals[0]?.aborted, true);
  assert.equal(caller.signal.aborted, false);
  assert.equal(provider.signals[1]?.aborted, false);
});

test("the global deadline wins when it is earlier than a model timeout", async () => {
  const clock = new FakeClock();
  let modelSignal: AbortSignal | undefined;
  const provider: LlmProvider = {
    respond: async (_messages, _tools, signal) => {
      modelSignal = signal;
      return await new Promise(() => undefined);
    }
  };
  const pending = investigate("question", dependencies(provider, new ToolRegistry(), { modelTimeoutMs: 20, deadlineMs: 5, clock }));

  await tick();
  clock.advance(5);
  const result = await pending;

  assert.equal(result.reason, "deadline");
  assert.equal(result.complete, false);
  assert.match(result.answer, /Investigation incomplete \(deadline\)\. Collected 0 evidence item\(s\): none\./);
  assert.equal(modelSignal?.aborted, true);
});

test("a late tool completion cannot add evidence after the deadline", async () => {
  const clock = new FakeClock();
  let finishTool: ((result: { status: "success"; content: string; metadata: { resource: string; collectedAt: string } }) => void) | undefined;
  let resolveToolStarted: (() => void) | undefined;
  const toolStarted = new Promise<void>((resolve) => { resolveToolStarted = resolve; });
  const provider = new ScriptedProvider([
    { content: "Inspecting.", toolCalls: [{ id: "call-1", name: "late", arguments: {} }] }
  ]);
  const registry = registryWithTool({
    name: "late",
    execute: async () => await new Promise((resolve) => {
      finishTool = resolve;
      resolveToolStarted?.();
    })
  });
  const pending = investigate("question", dependencies(provider, registry, { deadlineMs: 5, subprocessTimeoutMs: 20, clock }));

  await toolStarted;
  clock.advance(5);
  const result = await pending;
  finishTool?.({ status: "success", content: "late evidence", metadata: { resource: "late", collectedAt: "now" } });
  await tick();

  assert.equal(result.reason, "deadline");
  assert.deepEqual(result.evidence, []);
  assert.equal(provider.signals.length, 1);
});

test("a bounded tool batch preserves provider call order and matching IDs", async () => {
  const deferred = new Map<string, () => void>();
  const started = new Map<string, () => void>();
  const startedPromises = ["success-first", "executor-error", "success-last"].map((name) =>
    new Promise<void>((resolve) => started.set(name, resolve))
  );
  let active = 0;
  let peakActive = 0;
  const wait = (name: string) => new Promise<void>((resolve) => {
    deferred.set(name, () => resolve());
    active += 1;
    peakActive = Math.max(peakActive, active);
    started.get(name)?.();
  });
  let secondRequest: readonly Message[] | undefined;
  let requests = 0;
  const provider: LlmProvider = {
    respond: async (messages) => {
      requests += 1;
      if (requests === 2) {
        secondRequest = messages;
        return { content: "Done.", toolCalls: [] };
      }
      return {
        content: "Inspecting.",
        toolCalls: [
          { id: "call-success-first", name: "success-first", arguments: {} },
          { id: "call-invalid", name: "invalid", arguments: {} },
          { id: "call-unknown", name: "unknown", arguments: {} },
          { id: "call-executor-error", name: "executor-error", arguments: {} },
          { id: "call-success-last", name: "success-last", arguments: {} }
        ]
      };
    }
  };
  const registry = new ToolRegistry();
  for (const name of ["success-first", "success-last"]) {
    registry.register({
      name,
      description: name,
      parameters: {},
      parseArguments: (input) => input,
      execute: async () => {
        await wait(name);
        active -= 1;
        return { status: "success", content: `${name} result`, metadata: { resource: name, collectedAt: "now" } };
      }
    });
  }
  registry.register({
    name: "invalid",
    description: "invalid",
    parameters: {},
    parseArguments: () => { throw new Error("bad arguments"); },
    execute: async () => ({ status: "success", content: "unreachable", metadata: { resource: "invalid", collectedAt: "now" } })
  });
  registry.register({
    name: "executor-error",
    description: "executor-error",
    parameters: {},
    parseArguments: (input) => input,
    execute: async () => {
      await wait("executor-error");
      active -= 1;
      throw new Error("executor failure");
    }
  });

  const pending = investigate("question", dependencies(provider, registry, { maxToolCalls: 5, maxConcurrentToolCalls: 2 }));
  await Promise.all(startedPromises.slice(0, 2));
  assert.equal(peakActive, 2);
  deferred.get("executor-error")?.();
  await startedPromises[2];
  deferred.get("success-last")?.();
  deferred.get("success-first")?.();
  const result = await pending;

  assert.equal(result.complete, true);
  assert.equal(peakActive, 2);
  assert.deepEqual(result.evidence.map((item) => [item.id, item.toolCallId]), [
    ["E1", "call-success-first"],
    ["E2", "call-success-last"]
  ]);
  const toolMessages = secondRequest?.filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool") ?? [];
  assert.deepEqual(toolMessages.map((message) => [message.name, message.toolCallId]), [
    ["success-first", "call-success-first"],
    ["invalid", "call-invalid"],
    ["unknown", "call-unknown"],
    ["executor-error", "call-executor-error"],
    ["success-last", "call-success-last"]
  ]);
  assert.match(toolMessages[1]?.content ?? "", /invalid-arguments/);
  assert.match(toolMessages[2]?.content ?? "", /unknown-tool/);
  assert.match(toolMessages[3]?.content ?? "", /internal/);
});

test("successful dispatches retain only safe, budgeted evidence and provider history", async () => {
  const secret = "test-secret-value";
  const provider = new ScriptedProvider([
    {
      content: "Inspecting.",
      toolCalls: [
        { id: "call-first", name: "first", arguments: {} },
        { id: "call-prefix", name: "prefix", arguments: {} },
        { id: "call-omitted", name: "omitted", arguments: {} }
      ]
    },
    { content: "Done.", toolCalls: [] }
  ]);
  const registry = new ToolRegistry();
  for (const [name, content] of [
    ["first", `${secret}-abcdef`],
    ["prefix", "wxyz"],
    ["omitted", "later"]
  ] as const) {
    registry.register({
      name,
      description: name,
      parameters: {},
      parseArguments: (input) => input,
      execute: async () => ({ status: "success", content, metadata: { resource: name, collectedAt: "now" } })
    });
  }

  const result = await investigate("question", dependencies(provider, registry, {
    maxToolCalls: 3,
    maxConcurrentToolCalls: 3,
    maxCharsPerResult: 4,
    maxEvidenceChars: 6,
    knownSecrets: [secret]
  }));

  assert.deepEqual(result.evidence.map((item) => [item.id, item.toolCallId, item.content]), [
    ["E1", "call-first", "[RED"],
    ["E2", "call-prefix", "wx"]
  ]);
  assert.deepEqual(result.evidence[0]?.evidenceTruncations, [{
    truncated: true, reason: "character-limit", originalCharacterCount: 17, retainedCharacterCount: 4
  }]);
  assert.deepEqual(result.evidence[1]?.evidenceTruncations, [{
    truncated: true, reason: "evidence-budget", originalCharacterCount: 4, retainedCharacterCount: 2
  }]);
  const toolMessages = provider.requests[1]?.filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool") ?? [];
  assert.match(toolMessages[0]?.content ?? "", /redacted.*truncated: character-limit/);
  assert.match(toolMessages[1]?.content ?? "", /truncated: evidence-budget/);
  assert.equal(toolMessages[2]?.content, "Observation omitted (truncated: character-limit; truncated: evidence-budget).");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(provider.requests), new RegExp(secret));
});

test("a zero evidence budget omits successful observations without allocating IDs", async () => {
  const provider = new ScriptedProvider([
    { content: "Inspecting.", toolCalls: [{ id: "call-1", name: "inspect", arguments: {} }] },
    { content: "Done.", toolCalls: [] }
  ]);
  const result = await investigate("question", dependencies(provider, registryWithTool({
    name: "inspect",
    execute: async () => ({ status: "success", content: "observation", metadata: { resource: "inspect", collectedAt: "now" } })
  }), { maxEvidenceChars: 0 }));

  assert.deepEqual(result.evidence, []);
  const toolMessage = provider.requests[1]?.find((message): message is Extract<Message, { role: "tool" }> => message.role === "tool");
  assert.equal(toolMessage?.content, "Observation omitted (truncated: evidence-budget).");
});

test("suppresses a third canonical-identical completed call while retaining its tool-call ID", async () => {
  let executions = 0;
  const provider = new ScriptedProvider([
    { content: "first", toolCalls: [{ id: "call-1", name: "inspect", arguments: { nested: { a: 1, b: 2 }, labels: ["one", "two"] } }] },
    { content: "second", toolCalls: [{ id: "call-2", name: "inspect", arguments: { labels: ["one", "two"], nested: { b: 2, a: 1 } } }] },
    {
      content: "third",
      toolCalls: [
        { id: "call-3", name: "inspect", arguments: { nested: { a: 1, b: 2 }, labels: ["one", "two"] } },
        { id: "call-4", name: "inspect", arguments: { labels: ["one", "two"], nested: { b: 2, a: 1 } } }
      ]
    },
    { content: "Done.", toolCalls: [] }
  ]);
  const result = await investigate("question", dependencies(provider, registryWithTool({
    name: "inspect",
    execute: async () => {
      executions += 1;
      return { status: "success", content: "same result", metadata: { resource: "inspect", collectedAt: "now" } };
    }
  }), { maxModelCalls: 4, maxToolCalls: 4 }));

  assert.equal(result.complete, true);
  assert.equal(executions, 2);
  const suppressed = provider.requests[3]?.filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool" && (message.toolCallId === "call-3" || message.toolCallId === "call-4")) ?? [];
  assert.deepEqual(suppressed.map((message) => [message.name, message.toolCallId]), [["inspect", "call-3"], ["inspect", "call-4"]]);
  assert.ok(suppressed.every((message) => /^Tool error \(duplicate\):/.test(message.content)));
});

test("a changed completed result resets duplicate suppression", async () => {
  const outputs = ["first", "changed", "changed"];
  let executions = 0;
  const provider = new ScriptedProvider([
    ...Array.from({ length: 4 }, (_, index) => ({ content: `turn ${index}`, toolCalls: [{ id: `call-${index + 1}`, name: "inspect", arguments: { target: "api" } }] })),
    { content: "Done.", toolCalls: [] }
  ]);
  const result = await investigate("question", dependencies(provider, registryWithTool({
    name: "inspect",
    execute: async () => {
      const content = outputs[executions]!;
      executions += 1;
      return { status: "success", content, metadata: { resource: "inspect", collectedAt: "now" } };
    }
  }), { maxModelCalls: 5, maxToolCalls: 5 }));

  assert.equal(result.complete, true);
  assert.equal(executions, 3);
  assert.doesNotMatch(JSON.stringify(provider.requests[3]), /duplicate/);
  assert.match(JSON.stringify(provider.requests[4]), /duplicate/);
});

test("completed tool errors are safely tracked and later receive duplicate tool messages", async () => {
  let executions = 0;
  const provider = new ScriptedProvider([
    { content: "first", toolCalls: [{ id: "call-1", name: "inspect", arguments: {} }] },
    { content: "second", toolCalls: [{ id: "call-2", name: "inspect", arguments: {} }] },
    { content: "third", toolCalls: [{ id: "call-3", name: "inspect", arguments: {} }] },
    { content: "Done.", toolCalls: [] }
  ]);
  const result = await investigate("question", dependencies(provider, registryWithTool({
    name: "inspect",
    execute: async () => {
      executions += 1;
      return { status: "error", code: "unavailable", message: "Service is unavailable.", retryable: false };
    }
  }), { maxModelCalls: 4, maxToolCalls: 3 }));

  assert.equal(result.complete, true);
  assert.equal(executions, 2);
  const suppressed = provider.requests[3]?.filter((message): message is Extract<Message, { role: "tool" }> => message.role === "tool").at(-1);
  assert.deepEqual(suppressed && [suppressed.name, suppressed.toolCallId], ["inspect", "call-3"]);
  assert.match(suppressed?.content ?? "", /^Tool error \(duplicate\):/);
});

class ScriptedProvider implements LlmProvider {
  public readonly signals: AbortSignal[] = [];
  public readonly requests: Message[][] = [];
  public readonly tools: number[] = [];

  public constructor(private readonly responses: AssistantResponse[]) {}

  public async respond(
    messages: readonly Message[],
    _tools: readonly ToolDefinition[],
    signal: AbortSignal
  ): Promise<AssistantResponse> {
    this.signals.push(signal);
    this.requests.push([...structuredClone(messages)]);
    this.tools.push(_tools.length);
    const next = this.responses.shift();
    if (!next) throw new Error("No scripted response remains.");
    return next;
  }
}

function dependencies(
  provider: LlmProvider,
  registry: ToolRegistry,
  overrides: Partial<{
    modelTimeoutMs: number;
    maxModelCalls: number;
    subprocessTimeoutMs: number;
    deadlineMs: number;
    maxToolCalls: number;
    maxConcurrentToolCalls: number;
    maxCharsPerResult: number;
    maxEvidenceChars: number;
    knownSecrets: readonly string[];
    clock: FakeClock;
  }> = {}
) {
  return {
    provider,
    registry,
    systemPrompt: "Investigate.",
    limits: {
      maxModelCalls: overrides.maxModelCalls ?? 3,
      maxToolCalls: overrides.maxToolCalls ?? 2,
      deadlineMs: overrides.deadlineMs ?? 1_000,
      modelTimeoutMs: overrides.modelTimeoutMs ?? 100,
      subprocessTimeoutMs: overrides.subprocessTimeoutMs ?? 100,
      maxConcurrentToolCalls: overrides.maxConcurrentToolCalls ?? 1,
      maxLogLines: 100,
      maxRowsPerResult: 100,
      maxCharsPerResult: overrides.maxCharsPerResult ?? 1_000,
      maxEvidenceChars: overrides.maxEvidenceChars ?? 2_000
    },
    knownSecrets: overrides.knownSecrets,
    now: overrides.clock ? () => overrides.clock!.now : undefined,
    timers: overrides.clock
  };
}

function registryWithTool(tool: Pick<ToolRegistration, "name" | "execute">): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    ...tool,
    description: tool.name,
    parameters: {},
    parseArguments: (input) => input
  });
  return registry;
}

class FakeClock implements InvestigationTimers {
  public now = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { dueAt: number; callback: () => void }>();

  public setTimeout(callback: () => void, delayMs: number): number {
    const id = this.nextId++;
    this.timers.set(id, { dueAt: this.now + delayMs, callback });
    return id;
  }

  public clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  public advance(delayMs: number): void {
    this.now += delayMs;
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= this.now)
        .sort(([, left], [, right]) => left.dueAt - right.dueAt)[0];
      if (!next) return;
      this.timers.delete(next[0]);
      next[1].callback();
    }
  }
}

async function tick(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}
