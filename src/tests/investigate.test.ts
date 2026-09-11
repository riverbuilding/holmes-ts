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
  assert.notEqual(modelSignal, caller.signal);
  assert.notEqual(toolSignal, caller.signal);
  assert.equal(toolSignal?.aborted, true);
});

test("model timeout aborts only its child signal", async () => {
  const clock = new FakeClock();
  let modelSignal: AbortSignal | undefined;
  const caller = new AbortController();
  const provider: LlmProvider = {
    respond: async (_messages, _tools, signal) => {
      modelSignal = signal;
      return await new Promise(() => undefined);
    }
  };
  const pending = investigate("question", dependencies(provider, new ToolRegistry(), { modelTimeoutMs: 10, deadlineMs: 50, clock }), caller.signal);

  await tick();
  clock.advance(10);
  const result = await pending;

  assert.equal(result.reason, "provider-error");
  assert.equal(modelSignal?.aborted, true);
  assert.equal(caller.signal.aborted, false);
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

class ScriptedProvider implements LlmProvider {
  public readonly signals: AbortSignal[] = [];

  public constructor(private readonly responses: AssistantResponse[]) {}

  public async respond(
    _messages: readonly Message[],
    _tools: readonly ToolDefinition[],
    signal: AbortSignal
  ): Promise<AssistantResponse> {
    this.signals.push(signal);
    const next = this.responses.shift();
    if (!next) throw new Error("No scripted response remains.");
    return next;
  }
}

function dependencies(
  provider: LlmProvider,
  registry: ToolRegistry,
  overrides: Partial<{ modelTimeoutMs: number; subprocessTimeoutMs: number; deadlineMs: number; clock: FakeClock }> = {}
) {
  return {
    provider,
    registry,
    systemPrompt: "Investigate.",
    limits: {
      maxModelCalls: 3,
      maxToolCalls: 2,
      deadlineMs: overrides.deadlineMs ?? 1_000,
      modelTimeoutMs: overrides.modelTimeoutMs ?? 100,
      subprocessTimeoutMs: overrides.subprocessTimeoutMs ?? 100,
      maxConcurrentToolCalls: 1,
      maxLogLines: 100,
      maxRowsPerResult: 100,
      maxCharsPerResult: 1_000,
      maxEvidenceChars: 2_000
    },
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
