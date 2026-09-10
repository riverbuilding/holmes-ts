import assert from "node:assert/strict";
import test from "node:test";
import { createDockerTools } from "../tools/docker.js";

const tools = new Map(createDockerTools({}).map((tool) => [tool.name, tool]));

test("all nine Docker schemas accept supported arguments and apply defaults", () => {
  const accepted: Array<[string, unknown, unknown]> = [
    ["docker_images", {}, {}],
    ["docker_ps", {}, {}],
    ["docker_ps_all", {}, {}],
    ["docker_inspect", { container_or_image_id: "api" }, { container_or_image_id: "api" }],
    ["docker_logs", { container_id: "api" }, { container_id: "api", tail: 100 }],
    ["docker_top", { container_id: "api" }, { container_id: "api" }],
    ["docker_events", { container_id: "api", since: "2026-09-09T10:00:00Z", until: "2026-09-09T11:00:00Z" }, { container_id: "api", since: "2026-09-09T10:00:00Z", until: "2026-09-09T11:00:00Z", limit: 100 }],
    ["docker_history", { image_id: "repo/api:latest" }, { image_id: "repo/api:latest", limit: 100 }],
    ["docker_diff", { container_id: "api" }, { container_id: "api" }]
  ];
  for (const [name, input, expected] of accepted) assert.deepEqual(tool(name).parseArguments(input), expected, name);
});

test("all schemas reject unknown keys", () => {
  for (const name of tools.keys()) assert.throws(() => tool(name).parseArguments({ unexpected: true }), /Unknown argument/);
});

test("resource schemas reject empty and flag-like identifiers", () => {
  const resources: Array<[string, string, Record<string, string>]> = [
    ["docker_inspect", "container_or_image_id", {}], ["docker_logs", "container_id", {}], ["docker_top", "container_id", {}],
    ["docker_events", "container_id", { since: "2026-09-09T10:00:00Z", until: "2026-09-09T11:00:00Z" }],
    ["docker_history", "image_id", {}], ["docker_diff", "container_id", {}]
  ];
  for (const [name, field, shared] of resources) {
    assert.throws(() => tool(name).parseArguments({ ...shared, [field]: "" }));
    assert.throws(() => tool(name).parseArguments({ ...shared, [field]: "--format" }));
  }
});

test("bounded parameters reject values above their public maximum", () => {
  assert.throws(() => tool("docker_logs").parseArguments({ container_id: "api", tail: 101 }));
  assert.throws(() => tool("docker_events").parseArguments({ since: "2026-09-09T10:00:00Z", until: "2026-09-09T11:00:00Z", limit: 101 }));
  assert.throws(() => tool("docker_history").parseArguments({ image_id: "api", limit: 101 }));
});

test("events require an ordered ISO-8601 historical window", () => {
  assert.throws(() => tool("docker_events").parseArguments({ until: "2026-09-09T11:00:00Z" }));
  assert.throws(() => tool("docker_events").parseArguments({ since: "tomorrow", until: "2026-09-09T11:00:00Z" }));
  assert.throws(() => tool("docker_events").parseArguments({ since: "2026-09-09T12:00:00Z", until: "2026-09-09T11:00:00Z" }));
});

function tool(name: string) {
  const definition = tools.get(name);
  assert.ok(definition, `Missing ${name}`);
  return definition;
}
