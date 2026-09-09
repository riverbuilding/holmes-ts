import assert from "node:assert/strict";
import test from "node:test";
import type { ToolRegistration } from "../core/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { identifier, imageReference, objectShape, positiveBoundedInteger, timeWindow } from "../tools/validation.js";

test("registry rejects invalid, unknown, and flag-like arguments before executing a tool", async () => {
  let executions = 0;
  const registry = new ToolRegistry();
  registry.register(testTool(() => { executions += 1; }));
  const signal = new AbortController().signal;

  for (const arguments_ of [null, { container: "api", unexpected: true }, { container: "--privileged" }]) {
    const result = await registry.dispatch({ id: "call-1", name: "docker_inspect", arguments: arguments_ }, signal);
    assert.deepEqual(result.status, "error");
    if (result.status === "error") assert.equal(result.code, "invalid-arguments");
  }
  assert.equal(executions, 0);
});

test("registry owns dispatch lookup and exposes schemas without parsers or executors", async () => {
  const registry = new ToolRegistry();
  registry.register(testTool(() => {}));

  assert.deepEqual(registry.list(), [{
    name: "docker_inspect",
    description: "Inspect a Docker object.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["container"],
      properties: { container: { type: "string" } }
    }
  }]);
  const result = await registry.dispatch(
    { id: "call-unknown", name: "unknown", arguments: {} },
    new AbortController().signal
  );
  assert.equal(result.status, "error");
  if (result.status === "error") assert.equal(result.code, "unknown-tool");
});

test("shared validators enforce bounded integers, image references, and ordered timestamp windows", () => {
  assert.equal(positiveBoundedInteger(100, "tail", 100), 100);
  assert.throws(() => positiveBoundedInteger(101, "tail", 100));
  assert.equal(imageReference("repo/app:latest", "image"), "repo/app:latest");
  assert.throws(() => imageReference("-v", "image"));
  assert.deepEqual(timeWindow({ since: "2026-09-09T10:00:00Z", until: "2026-09-09T11:00:00Z" }), {
    since: "2026-09-09T10:00:00Z",
    until: "2026-09-09T11:00:00Z"
  });
  assert.throws(() => timeWindow({ since: "2026-09-09T12:00:00Z", until: "2026-09-09T11:00:00Z" }));
});

function testTool(onExecute: () => void): ToolRegistration<{ container: string }> {
  return {
    name: "docker_inspect",
    description: "Inspect a Docker object.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["container"],
      properties: { container: { type: "string" } }
    },
    parseArguments(input) {
      const object = objectShape(input, ["container"]);
      return { container: identifier(object.container, "container") };
    },
    async execute({ container }) {
      onExecute();
      return {
        status: "success",
        content: container,
        metadata: { resource: `container/${container}`, collectedAt: "2026-09-09T00:00:00.000Z" }
      };
    }
  };
}
