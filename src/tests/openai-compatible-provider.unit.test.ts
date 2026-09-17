import assert from "node:assert/strict";
import test from "node:test";
import { chatCompletionsUrl, OpenAiCompatibleProvider } from "../llm/openai-compatible-provider.js";

test("compatible provider derives one chat-completions path from an OpenAI-compatible base URL", () => {
  assert.equal(chatCompletionsUrl("https://api.groq.com/openai/v1"), "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(chatCompletionsUrl("https://api.groq.com/openai/v1/"), "https://api.groq.com/openai/v1/chat/completions");
});

test("compatible provider normalizes complete token usage", async () => {
  const response = await respondWith({ prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 });
  assert.deepEqual(response.usage, { inputTokens: 12, outputTokens: 8, totalTokens: 20 });
});

test("compatible provider treats absent or malformed usage as unavailable", async () => {
  const absent = await respondWith(undefined);
  const malformed = await respondWith({ prompt_tokens: "12", completion_tokens: 8, total_tokens: 20 });
  assert.equal(absent.usage, undefined);
  assert.equal(malformed.usage, undefined);
});

async function respondWith(usage: unknown) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "Ready", tool_calls: [] } }],
        ...(usage === undefined ? {} : { usage })
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  try {
    const provider = new OpenAiCompatibleProvider({ apiKey: "test-key", model: "test-model" });
    return await provider.respond([{ role: "user", content: "Reply." }], [], new AbortController().signal);
  } finally {
    globalThis.fetch = originalFetch;
  }
}
