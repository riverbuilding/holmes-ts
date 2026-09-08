import assert from "node:assert/strict";
import test from "node:test";
import { investigate, type InvestigationProvider } from "../core/investigate.js";
import type { AssistantResponse, Message, ToolDefinition } from "../core/types.js";

test("the loop attaches evidence before accepting a final answer", async () => {
  const provider: InvestigationProvider = new ScriptedProvider([
    { content: "I will inspect the container.", toolCalls: [{ id: "call-1", name: "inspect_container", arguments: { name: "checkout" } }] },
    { content: "The container exited because APP_MODE is missing [E1].", toolCalls: [] }
  ]);
  const tool: ToolDefinition<{ name: string }> = {
    name: "inspect_container",
    description: "Inspect a container.",
    parameters: {},
    parseArguments: (input) => input as { name: string },
    execute: async ({ name }) => ({ content: "APP_MODE is missing", resource: `container/${name}`, collectedAt: "2026-09-08T00:00:00.000Z" })
  };
  const result = await investigate("Why did checkout exit?", {
    provider,
    tools: [tool],
    systemPrompt: "Investigate.",
    limits: { maxModelCalls: 3, maxToolCalls: 2, deadlineMs: 1_000 }
  });

  assert.equal(result.complete, true);
  assert.equal(result.evidence[0]?.id, "E1");
  assert.match(result.answer, /E1/);
});

class ScriptedProvider implements InvestigationProvider {
  public constructor(private readonly responses: AssistantResponse[]) {}

  public async respond(_messages: Message[], _tools: ToolDefinition[]): Promise<AssistantResponse> {
    const next = this.responses.shift();
    if (!next) throw new Error("No scripted response remains.");
    return next;
  }
}
