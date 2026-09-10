import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { loadConfig } from "../config.js";
import { ProviderError, type Message, type ProviderErrorCode, type ToolDefinition } from "../core/types.js";
import { OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";
import { createDockerTools } from "../tools/docker.js";

const liveProviderConfig = providerConfigFromEnvironment(environmentWithDotEnv(process.env));
const dockerTools: readonly ToolDefinition[] = createDockerTools({});

test("real model completes a docker_ps_all tool round trip", async () => {
  const provider = new OpenAiCompatibleProvider(liveProviderConfig);
  const signal = new AbortController().signal;
  const initialMessages: readonly Message[] = [
    {
      role: "system",
      content: "You are executing a provider integration test. You must obey the user's tool-call instruction exactly."
    },
    {
      role: "user",
      content: "Call exactly one tool now: docker_ps_all. Use an empty JSON object for its arguments. Do not write a final answer before the tool result."
    }
  ];

  // Supplying the full public tool surface verifies that the provider forwards
  // schemas; the model must select the requested tool from that surface.
  const toolTurn = await provider.respond(initialMessages, dockerTools, signal);

  assert.equal(toolTurn.toolCalls.length, 1, "the model must make exactly one tool call");
  const [toolCall] = toolTurn.toolCalls;
  assert.ok(toolCall, "the model tool call must be present");
  assert.equal(toolCall.name, "docker_ps_all");
  assert.ok(toolCall.id.length > 0, "the provider must assign a tool call ID");
  assert.deepEqual(toolCall.arguments, {});

  const finalMessages: readonly Message[] = [
    ...initialMessages,
    { role: "assistant", content: toolTurn.content, toolCalls: toolTurn.toolCalls },
    {
      role: "tool",
      name: toolCall.name,
      toolCallId: toolCall.id,
      content: JSON.stringify({ containers: [], source: "Phase 1 integration-test mock; Docker was not contacted." })
    },
    {
      role: "user",
      content: "Using the tool result, provide a concise final answer. Do not call another tool."
    }
  ];
  const finalTurn = await provider.respond(finalMessages, [], signal);

  assert.ok(finalTurn.content.trim().length > 0, "the model must return a final answer");
  assert.deepEqual(finalTurn.toolCalls, [], "the final synthesis must not make another tool call");
});

test("real provider reports an HTTP failure without exposing credentials", async () => {
  const provider = new OpenAiCompatibleProvider({
    ...liveProviderConfig,
    model: "holmes-phase-1-model-that-does-not-exist"
  });

  await assert.rejects(
    provider.respond([{ role: "user", content: "This request must fail because its model identifier is invalid." }], [], new AbortController().signal),
    (error: unknown) => hasProviderErrorCode(error, "http")
  );
});

test("real provider request honors its configured timeout", async () => {
  const provider = new OpenAiCompatibleProvider({ ...liveProviderConfig, modelTimeoutMs: 1 });

  await assert.rejects(
    provider.respond([{ role: "user", content: "Reply with ready." }], [], new AbortController().signal),
    (error: unknown) => hasProviderErrorCode(error, "timeout")
  );
});

test("real provider request honors caller cancellation", async () => {
  const provider = new OpenAiCompatibleProvider(liveProviderConfig);
  const controller = new AbortController();
  const request = provider.respond(
    [{ role: "user", content: "Write a detailed explanation of how DNS resolution works." }],
    [],
    controller.signal
  );
  const cancellation = setTimeout(() => controller.abort(), 10);

  try {
    await assert.rejects(request, (error: unknown) => hasProviderErrorCode(error, "cancelled"));
  } finally {
    clearTimeout(cancellation);
  }
});

/**
 * Loads only LLM_* entries from the repository's ignored .env file. Explicit
 * process environment values (including CI secrets) always win.
 */
function environmentWithDotEnv(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return environment;

  const merged: NodeJS.ProcessEnv = { ...environment };
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const entry = line.match(/^\s*(?:export\s+)?(LLM_[A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!entry) continue;

    const [, name, rawValue] = entry;
    if (merged[name] !== undefined) continue;
    merged[name] = dotEnvValue(rawValue);
  }
  return merged;
}

function dotEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

/** Loads injected CI or local credentials without exposing them in test output. */
function providerConfigFromEnvironment(environment: NodeJS.ProcessEnv) {
  if (!environment.LLM_API_KEY) {
    throw new Error("LLM_API_KEY must be set to run the required real-model provider test.");
  }
  return loadConfig(environment).provider;
}

function hasProviderErrorCode(error: unknown, expectedCode: ProviderErrorCode): boolean {
  return error instanceof ProviderError && error.code === expectedCode && !error.message.includes(liveProviderConfig.apiKey);
}
