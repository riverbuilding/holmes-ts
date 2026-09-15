import assert from "node:assert/strict";
import test from "node:test";
import type { DockerCommandResult } from "../core/types.js";
import { createDockerTools } from "../tools/docker.js";
import { createFixtureTools } from "../tools/fixtures.js";

test("docker_ps and docker_ps_all issue fixed discovery operations in the pinned context", async () => {
  const calls: Array<{ operation: unknown; context: string | undefined; timeoutMs: number }> = [];
  const cli = {
    async execute(operation: unknown, context: string | undefined, _signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
      calls.push({ operation, context, timeoutMs });
      return completed("{\"ID\":\"api-id\",\"Names\":\"api\",\"Image\":\"checkout:1.4\"}");
    }
  };
  const tools = toolMap(createDockerTools({ context: "team-dev", cli, commandTimeoutMs: 321 }));

  const running = await requiredTool(tools, "docker_ps").execute({}, new AbortController().signal);
  const all = await requiredTool(tools, "docker_ps_all").execute({}, new AbortController().signal);

  assert.deepEqual(calls, [
    { operation: { kind: "container-ls", all: false }, context: "team-dev", timeoutMs: 321 },
    { operation: { kind: "container-ls", all: true }, context: "team-dev", timeoutMs: 321 }
  ]);
  assert.equal(running.status, "success");
  assert.equal(all.status, "success");
});

test("discovery maps daemon failures and applies the fixed row limit", async () => {
  const unavailable = {
    async execute(): Promise<DockerCommandResult> {
      return { stdout: "", stderr: "Cannot connect to the Docker daemon at unix:///private.sock", exitCode: 1, durationMs: 3, termination: "nonzero-exit", outputTruncated: false };
    }
  };
  const unavailableResult = await requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: unavailable })), "docker_ps").execute({}, new AbortController().signal);
  assert.deepEqual(unavailableResult, { status: "error", code: "unavailable", message: "Docker is unavailable.", retryable: true });

  const rows = Array.from({ length: 101 }, (_, index) => JSON.stringify({ ID: `id-${index}`, Names: `container-${String(index).padStart(3, "0")}` })).join("\n");
  const limited = {
    async execute(): Promise<DockerCommandResult> { return completed(rows); }
  };
  const limitedResult = await requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: limited })), "docker_ps_all").execute({}, new AbortController().signal);
  assert.equal(limitedResult.status, "success");
  assert.deepEqual(limitedResult.truncation, { truncated: true, reason: "row-limit", originalItemCount: 101, retainedItemCount: 100 });
  assert.equal(JSON.parse(limitedResult.content).containers.length, 100);
});

test("fixtures share discovery schemas and execute without a Docker CLI", async () => {
  const live = toolMap(createDockerTools({}));
  const fixture = toolMap(createFixtureTools("missing-env"));
  for (const name of ["docker_ps", "docker_ps_all"] as const) {
    assert.deepEqual(requiredTool(fixture, name).parameters, requiredTool(live, name).parameters);
    assert.deepEqual(requiredTool(fixture, name).parseArguments({}), {});
  }

  const running = await requiredTool(fixture, "docker_ps").execute({}, new AbortController().signal);
  const all = await requiredTool(fixture, "docker_ps_all").execute({}, new AbortController().signal);
  assert.equal(running.status, "success");
  assert.equal(all.status, "success");
  assert.deepEqual(JSON.parse(running.content), { containers: [{ id: "checkout-db", name: "checkout-db", image: "postgres:16", status: "Up 10 minutes", state: "running" }] });
  assert.deepEqual(JSON.parse(all.content), { containers: [
    { id: "checkout-api", name: "checkout-api", image: "checkout:1.4", status: "Exited (1) 2 minutes ago", state: "exited" },
    { id: "checkout-db", name: "checkout-db", image: "postgres:16", status: "Up 10 minutes", state: "running" }
  ] });
});

function completed(stdout: string): DockerCommandResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 3, termination: "completed", outputTruncated: false };
}

function toolMap(tools: ReturnType<typeof createDockerTools>): Map<string, ReturnType<typeof createDockerTools>[number]> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function requiredTool(tools: Map<string, ReturnType<typeof createDockerTools>[number]>, name: string): ReturnType<typeof createDockerTools>[number] {
  const tool = tools.get(name);
  assert.ok(tool, `missing ${name}`);
  return tool;
}
