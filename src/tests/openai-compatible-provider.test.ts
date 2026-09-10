import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../config.js";
import { OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";

const liveProviderConfig = providerConfigFromEnvironment(process.env);

test("OpenRouter free-tier adapter responds to a live request", {
  skip: liveProviderConfig === undefined
    ? "Set LLM_LIVE_TEST=1 and LLM_API_KEY to run the live OpenRouter test."
    : undefined
}, async () => {
  assert.ok(liveProviderConfig);
  const provider = new OpenAiCompatibleProvider(liveProviderConfig);
  const response = await provider.respond(
    [{ role: "user", content: "Reply with the single word: ready" }],
    [],
    new AbortController().signal
  );

  assert.equal(typeof response.content, "string");
  assert.ok(response.content.length > 0);
  assert.deepEqual(response.toolCalls, []);
});

/**
 * The explicit parameter lets test runners inject credentials without reading
 * process.env directly (for example, CI secret injection or a local .env loader).
 */
function providerConfigFromEnvironment(environment: NodeJS.ProcessEnv) {
  if (environment.LLM_LIVE_TEST !== "1" || !environment.LLM_API_KEY) return undefined;
  return loadConfig(environment).provider;
}
