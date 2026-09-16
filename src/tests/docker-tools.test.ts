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

test("docker_images uses the fixed image-list operation and shared image projection", async () => {
  const calls: Array<{ operation: unknown; context: string | undefined; timeoutMs: number }> = [];
  const cli = {
    async execute(operation: unknown, context: string | undefined, _signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
      calls.push({ operation, context, timeoutMs });
      return completed([
        JSON.stringify({ Repository: "checkout", Tag: "1.4", ID: "sha256:checkout", CreatedAt: "2026-09-15 12:00:00", CreatedSince: "one hour ago", Size: "12MB" }),
        JSON.stringify({ Repository: "<none>", Tag: "<none>", ID: "sha256:stale", CreatedAt: "2026-09-15 11:00:00", CreatedSince: "two hours ago", Size: "8MB", Labels: { token: "never-visible" } })
      ].join("\n"));
    }
  };
  const images = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli, commandTimeoutMs: 321 })), "docker_images");
  const result = await images.execute(images.parseArguments({}), new AbortController().signal);

  assert.deepEqual(calls, [{ operation: { kind: "image-ls" }, context: "team-dev", timeoutMs: 321 }]);
  assert.equal(result.status, "success");
  assert.deepEqual(JSON.parse(result.content), {
    images: [
      { id: "sha256:stale", createdAt: "2026-09-15 11:00:00", createdSince: "two hours ago", size: "8MB", dangling: true },
      { id: "sha256:checkout", repository: "checkout", tag: "1.4", createdAt: "2026-09-15 12:00:00", createdSince: "one hour ago", size: "12MB", dangling: false }
    ]
  });
  assert.doesNotMatch(JSON.stringify(result), /never-visible/);
});

test("docker_images maps malformed and daemon failures to structured errors", async () => {
  const malformed = {
    async execute(): Promise<DockerCommandResult> {
      return completed('{"Repository":"checkout"}');
    }
  };
  const images = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: malformed })), "docker_images");
  assert.deepEqual(await images.execute({}, new AbortController().signal), {
    status: "error", code: "malformed-output", message: "Docker returned malformed output.", retryable: false
  });

  const unavailable = {
    async execute(): Promise<DockerCommandResult> {
      return { stdout: "", stderr: "Cannot connect to the Docker daemon at unix:///private.sock", exitCode: 1, durationMs: 3, termination: "nonzero-exit", outputTruncated: false };
    }
  };
  const unavailableImages = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: unavailable })), "docker_images");
  assert.deepEqual(await unavailableImages.execute({}, new AbortController().signal), {
    status: "error", code: "unavailable", message: "Docker is unavailable.", retryable: true
  });
});

test("docker_top uses the fixed process operation and safely projects bounded rows", async () => {
  const calls: Array<{ operation: unknown; context: string | undefined; timeoutMs: number }> = [];
  const cli = {
    async execute(operation: unknown, context: string | undefined, _signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
      calls.push({ operation, context, timeoutMs });
      return completed("PID  USER  COMMAND\n20  app  node server.js\n10  root  sleep 1\n");
    }
  };
  const top = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli, commandTimeoutMs: 321 })), "docker_top");
  const result = await top.execute(top.parseArguments({ container_id: "checkout-api" }), new AbortController().signal);

  assert.deepEqual(calls, [{ operation: { kind: "container-top", container: "checkout-api" }, context: "team-dev", timeoutMs: 321 }]);
  assert.equal(result.status, "success");
  assert.deepEqual(JSON.parse(result.content), {
    headers: ["PID", "USER", "COMMAND"],
    processes: [{ fields: ["10", "root", "sleep 1"] }, { fields: ["20", "app", "node server.js"] }]
  });
  assert.throws(() => top.parseArguments({ container_id: "checkout-api", ps_args: "aux" }), /Unknown argument/);
  assert.throws(() => top.parseArguments({ container_id: "--format" }), /must not start/);
});

test("docker_top maps stopped and missing containers without returning Docker errors", async () => {
  const stopped = {
    async execute(): Promise<DockerCommandResult> {
      return { stdout: "", stderr: "Error response from daemon: Container private-token is not running", exitCode: 1, durationMs: 3, termination: "nonzero-exit", outputTruncated: false };
    }
  };
  const top = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: stopped })), "docker_top");
  assert.deepEqual(await top.execute(top.parseArguments({ container_id: "checkout-api" }), new AbortController().signal), {
    status: "error", code: "nonzero-exit", message: "Docker container is not running.", retryable: false
  });

  const missing = {
    async execute(): Promise<DockerCommandResult> {
      return { stdout: "", stderr: "Error response from daemon: No such container: private-token", exitCode: 1, durationMs: 3, termination: "nonzero-exit", outputTruncated: false };
    }
  };
  const missingTop = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: missing })), "docker_top");
  assert.deepEqual(await missingTop.execute(missingTop.parseArguments({ container_id: "checkout-api" }), new AbortController().signal), {
    status: "error", code: "not-found", message: "Docker resource was not found.", retryable: false
  });
});

test("docker_diff uses the fixed operation, projects paths, and retains the row cap", async () => {
  const calls: Array<{ operation: unknown; context: string | undefined; timeoutMs: number }> = [];
  const rows = Array.from({ length: 101 }, (_, index) => `A /app/${String(index).padStart(3, "0")}`).join("\n");
  const cli = {
    async execute(operation: unknown, context: string | undefined, _signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
      calls.push({ operation, context, timeoutMs });
      return completed(rows);
    }
  };
  const diff = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli, commandTimeoutMs: 321 })), "docker_diff");
  const result = await diff.execute(diff.parseArguments({ container_id: "checkout-api" }), new AbortController().signal);

  assert.deepEqual(calls, [{ operation: { kind: "container-diff", container: "checkout-api" }, context: "team-dev", timeoutMs: 321 }]);
  assert.equal(result.status, "success");
  assert.equal(JSON.parse(result.content).changes.length, 100);
  assert.deepEqual(result.truncation, { truncated: true, reason: "row-limit", originalItemCount: 101, retainedItemCount: 100 });
  assert.throws(() => diff.parseArguments({ container_id: "checkout-api", filter: "A" }), /Unknown argument/);
  assert.throws(() => diff.parseArguments({ container_id: "--format" }), /must not start/);
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

test("all fixtures expose each implemented tool through the live public contract", async () => {
  const live = toolMap(createDockerTools({}));
  const scenarios = [
    "missing-env",
    "unhealthy-container",
    "insufficient-evidence",
    "image-regression",
    "writable-layer-change"
  ] as const;

  for (const scenario of scenarios) {
    const fixture = toolMap(createFixtureTools(scenario));
    assert.deepEqual([...fixture.keys()], [...live.keys()]);
    for (const [name, liveTool] of live) {
      assert.deepEqual(requiredTool(fixture, name).parameters, liveTool.parameters);
    }

    const invocations: Readonly<Record<string, object>> = {
      docker_images: {},
      docker_ps: {},
      docker_ps_all: {},
      docker_inspect: { container_or_image_id: "missing" },
      docker_logs: { container_id: "missing" },
      docker_top: { container_id: "missing" },
      docker_events: { since: "2026-09-14T00:00:00Z", until: "2026-09-15T00:00:00Z" },
      docker_history: { image_id: "missing" },
      docker_diff: { container_id: "missing" }
    };
    for (const [name, arguments_] of Object.entries(invocations)) {
      const tool = requiredTool(fixture, name);
      const result = await tool.execute(tool.parseArguments(arguments_), new AbortController().signal);
      assert.notEqual(result.status === "error" ? result.code : undefined, "unavailable");
    }
  }
});

test("docker_inspect uses one fixed resource operation and projects container secrets safely", async () => {
  const calls: Array<{ operation: unknown; context: string | undefined; timeoutMs: number }> = [];
  const cli = {
    async execute(operation: unknown, context: string | undefined, _signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
      calls.push({ operation, context, timeoutMs });
      return completed(JSON.stringify([{
        Id: "container-id", Name: "/api", State: { Status: "exited", ExitCode: 1 },
        Config: { Image: "checkout:1.4", Env: ["PASSWORD=never-visible"], Labels: { team: "payments", auth_token: "never-visible" } },
        HostConfig: { Privileged: true }
      }]));
    }
  };
  const inspect = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli, commandTimeoutMs: 321 })), "docker_inspect");
  const result = await inspect.execute(inspect.parseArguments({ container_or_image_id: "checkout:1.4" }), new AbortController().signal);

  assert.deepEqual(calls, [{ operation: { kind: "inspect", resource: "checkout:1.4" }, context: "team-dev", timeoutMs: 321 }]);
  assert.equal(result.status, "success");
  assert.deepEqual(JSON.parse(result.content), {
    kind: "container", id: "container-id", name: "/api", imageReference: "checkout:1.4", state: "exited", exitCode: 1,
    labels: { auth_token: "<withheld>", team: "payments" }
  });
  assert.doesNotMatch(JSON.stringify(result), /never-visible|PASSWORD|Privileged/);
});

test("docker_inspect maps missing resources and rejects whitespace-bearing targets", async () => {
  const missing = {
    async execute(): Promise<DockerCommandResult> {
      return { stdout: "", stderr: "Error response from daemon: No such object: missing", exitCode: 1, durationMs: 3, termination: "nonzero-exit", outputTruncated: false };
    }
  };
  const inspect = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: missing })), "docker_inspect");
  assert.throws(() => inspect.parseArguments({ container_or_image_id: "checkout api" }), /must not contain whitespace/);
  const result = await inspect.execute(inspect.parseArguments({ container_or_image_id: "missing" }), new AbortController().signal);
  assert.deepEqual(result, { status: "error", code: "not-found", message: "Docker resource was not found.", retryable: false });

  const malformed = {
    async execute(): Promise<DockerCommandResult> { return completed("[{},{ }]"); }
  };
  const malformedInspect = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: malformed })), "docker_inspect");
  const malformedResult = await malformedInspect.execute(malformedInspect.parseArguments({ container_or_image_id: "checkout-api" }), new AbortController().signal);
  assert.deepEqual(malformedResult, { status: "error", code: "malformed-output", message: "Docker returned malformed output.", retryable: false });
});

test("inspect fixtures use the same schemas and container/image projector", async () => {
  const container = requiredTool(toolMap(createFixtureTools("missing-env")), "docker_inspect");
  const containerResult = await container.execute(container.parseArguments({ container_or_image_id: "checkout-api" }), new AbortController().signal);
  assert.equal(containerResult.status, "success");
  assert.deepEqual(JSON.parse(containerResult.content), {
    kind: "container", id: "checkout-api", name: "/checkout-api", imageReference: "checkout:1.4", createdAt: "2026-09-15T00:00:00.000Z",
    state: "exited", exitCode: 1, labels: { api_token: "<withheld>", service: "checkout" }
  });
  assert.doesNotMatch(JSON.stringify(containerResult), /never-visible|DATABASE_URL/);

  const image = requiredTool(toolMap(createFixtureTools("unhealthy-container")), "docker_inspect");
  const imageResult = await image.execute(image.parseArguments({ container_or_image_id: "checkout:1.4" }), new AbortController().signal);
  assert.equal(imageResult.status, "success");
  assert.deepEqual(JSON.parse(imageResult.content), {
    kind: "image", id: "sha256:checkout", tags: ["checkout:1.4"], createdAt: "2026-09-15T00:00:00.000Z", architecture: "amd64", os: "linux",
    command: ["node", "server.js"], labels: { password: "<withheld>", service: "checkout" }
  });
});

test("docker_history uses the fixed image operation, requested limit, and safe projection", async () => {
  const calls: Array<{ operation: unknown; context: string | undefined; timeoutMs: number }> = [];
  const cli = {
    async execute(operation: unknown, context: string | undefined, _signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
      calls.push({ operation, context, timeoutMs });
      return completed([
        JSON.stringify({ ID: "sha256:new", CreatedAt: "2026-09-15 12:00:00", CreatedSince: "one hour ago", CreatedBy: "/bin/sh -c #(nop)  CMD [\"node\" \"server.js\"]", Size: "0B", Comment: "" }),
        JSON.stringify({ ID: "sha256:old", CreatedAt: "2026-09-15 10:00:00", CreatedSince: "three hours ago", CreatedBy: "/bin/sh -c RUN token=never-visible", Size: "4MB", Comment: "release" })
      ].join("\n"));
    }
  };
  const history = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli, commandTimeoutMs: 321 })), "docker_history");
  const result = await history.execute(history.parseArguments({ image_id: "checkout:1.4", limit: 1 }), new AbortController().signal);

  assert.deepEqual(calls, [{ operation: { kind: "image-history", image: "checkout:1.4" }, context: "team-dev", timeoutMs: 321 }]);
  assert.equal(result.status, "success");
  assert.deepEqual(JSON.parse(result.content), {
    history: [{ id: "sha256:new", createdAt: "2026-09-15 12:00:00", createdSince: "one hour ago", size: "0B", comment: "", commandKind: "cmd" }]
  });
  assert.deepEqual(result.truncation, { truncated: true, reason: "row-limit", originalItemCount: 2, retainedItemCount: 1 });
  assert.doesNotMatch(JSON.stringify(result), /never-visible|server\.js/);
});

test("docker_history maps missing images and malformed output to structured errors", async () => {
  const missing = {
    async execute(): Promise<DockerCommandResult> {
      return { stdout: "", stderr: "Error response from daemon: No such image: missing", exitCode: 1, durationMs: 3, termination: "nonzero-exit", outputTruncated: false };
    }
  };
  const history = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: missing })), "docker_history");
  assert.deepEqual(await history.execute(history.parseArguments({ image_id: "missing" }), new AbortController().signal), {
    status: "error", code: "not-found", message: "Docker resource was not found.", retryable: false
  });

  const malformed = {
    async execute(): Promise<DockerCommandResult> {
      return completed("not-json");
    }
  };
  const malformedHistory = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: malformed })), "docker_history");
  assert.deepEqual(await malformedHistory.execute(malformedHistory.parseArguments({ image_id: "checkout:1.4" }), new AbortController().signal), {
    status: "error", code: "malformed-output", message: "Docker returned malformed output.", retryable: false
  });
});

test("docker_logs uses a bounded timestamped operation and projects safe failures", async () => {
  const calls: Array<{ operation: unknown; context: string | undefined; timeoutMs: number }> = [];
  const cli = {
    async execute(operation: unknown, context: string | undefined, _signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
      calls.push({ operation, context, timeoutMs });
      return completed("2026-09-15T12:00:00.000000000Z first\n2026-09-15T12:00:01.000000000Z second\n");
    }
  };
  const logs = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli, commandTimeoutMs: 321 })), "docker_logs");
  const result = await logs.execute(logs.parseArguments({ container_id: "checkout-api", tail: 1 }), new AbortController().signal);

  assert.deepEqual(calls, [{ operation: { kind: "container-logs", container: "checkout-api", tail: 1 }, context: "team-dev", timeoutMs: 321 }]);
  assert.equal(result.status, "success");
  assert.deepEqual(JSON.parse(result.content), { lines: ["2026-09-15T12:00:00.000000000Z first"] });
  assert.deepEqual(result.truncation, { truncated: true, reason: "line-limit", originalItemCount: 2, retainedItemCount: 1 });

  const unavailable = {
    async execute(): Promise<DockerCommandResult> {
      return { stdout: "", stderr: "Cannot connect to the Docker daemon at unix:///private.sock", exitCode: 1, durationMs: 3, termination: "nonzero-exit", outputTruncated: false };
    }
  };
  const failedLogs = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli: unavailable })), "docker_logs");
  assert.deepEqual(await failedLogs.execute(failedLogs.parseArguments({ container_id: "checkout-api" }), new AbortController().signal), {
    status: "error", code: "unavailable", message: "Docker is unavailable.", retryable: true
  });
});

test("docker_events requests a bounded historical window and projects lifecycle rows", async () => {
  const calls: Array<{ operation: unknown; context: string | undefined; timeoutMs: number }> = [];
  const cli = {
    async execute(operation: unknown, context: string | undefined, _signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
      calls.push({ operation, context, timeoutMs });
      return completed([
        JSON.stringify({ timeNano: 20, Type: "container", Action: "die", Actor: { ID: "checkout-api", Attributes: { name: "checkout-api", image: "checkout:1.4", password: "never-visible" } } }),
        JSON.stringify({ timeNano: 10, Type: "container", Action: "start", Actor: { ID: "checkout-api", Attributes: { name: "checkout-api", image: "checkout:1.4" } } })
      ].join("\n"));
    }
  };
  const events = requiredTool(toolMap(createDockerTools({ context: "team-dev", cli, commandTimeoutMs: 321, now: () => Date.parse("2026-09-15T13:00:00Z") })), "docker_events");
  const result = await events.execute(events.parseArguments({ container_id: "checkout-api", since: "2026-09-15T11:00:00Z", until: "2026-09-15T12:00:00Z", limit: 1 }), new AbortController().signal);

  assert.deepEqual(calls, [{
    operation: { kind: "events", container: "checkout-api", since: "2026-09-15T11:00:00Z", until: "2026-09-15T12:00:00Z" }, context: "team-dev", timeoutMs: 321
  }]);
  assert.equal(result.status, "success");
  assert.deepEqual(JSON.parse(result.content), { events: [{ timeNano: 10, type: "container", action: "start", resourceId: "checkout-api", resourceName: "checkout-api", image: "checkout:1.4" }] });
  assert.deepEqual(result.truncation, { truncated: true, reason: "row-limit", originalItemCount: 2, retainedItemCount: 1 });
  assert.doesNotMatch(JSON.stringify(result), /never-visible/);
});

test("docker_events rejects future and overlong windows before invoking Docker", () => {
  const events = requiredTool(toolMap(createDockerTools({ now: () => Date.parse("2026-09-15T12:00:00Z") })), "docker_events");
  assert.throws(() => events.parseArguments({ since: "2026-09-14T11:59:59Z", until: "2026-09-15T12:00:00Z" }), /must not exceed 24 hours/);
  assert.throws(() => events.parseArguments({ since: "2026-09-15T11:00:00Z", until: "2026-09-15T12:00:01Z" }), /must not be in the future/);
});

test("logs and events fixtures share schemas and bounded projectors", async () => {
  const live = toolMap(createDockerTools({}));
  const fixture = toolMap(createFixtureTools("missing-env"));
  for (const name of ["docker_logs", "docker_events"] as const) {
    assert.deepEqual(requiredTool(fixture, name).parameters, requiredTool(live, name).parameters);
  }

  const logs = requiredTool(fixture, "docker_logs");
  const logResult = await logs.execute(logs.parseArguments({ container_id: "checkout-api" }), new AbortController().signal);
  assert.equal(logResult.status, "success");
  assert.deepEqual(JSON.parse(logResult.content), { lines: ["2026-09-15T00:00:01.000000000Z configuration error: DATABASE_URL is required"] });

  const events = requiredTool(fixture, "docker_events");
  const eventResult = await events.execute(events.parseArguments({ container_id: "checkout-api", since: "2026-09-14T00:00:00Z", until: "2026-09-15T00:00:00Z" }), new AbortController().signal);
  assert.equal(eventResult.status, "success");
  assert.deepEqual(JSON.parse(eventResult.content), { events: [{ timeNano: 1768435201000000000, type: "container", action: "die", resourceId: "checkout-api", resourceName: "checkout-api", image: "checkout:1.4" }] });
});

test("image-regression fixture projects image evidence without raw history commands", async () => {
  const fixture = toolMap(createFixtureTools("image-regression"));
  const images = requiredTool(fixture, "docker_images");
  const imageResult = await images.execute(images.parseArguments({}), new AbortController().signal);
  assert.equal(imageResult.status, "success");
  assert.deepEqual(JSON.parse(imageResult.content), {
    images: [
      { id: "sha256:checkout-14", repository: "checkout", tag: "1.4", createdAt: "2026-09-14 00:00:00", createdSince: "one day ago", size: "24MB", dangling: false },
      { id: "sha256:checkout-15", repository: "checkout", tag: "1.5", createdAt: "2026-09-15 00:00:00", createdSince: "one minute ago", size: "26MB", dangling: false }
    ]
  });

  const history = requiredTool(fixture, "docker_history");
  const historyResult = await history.execute(history.parseArguments({ image_id: "checkout:1.5", limit: 1 }), new AbortController().signal);
  assert.equal(historyResult.status, "success");
  assert.deepEqual(JSON.parse(historyResult.content), {
    history: [{ id: "sha256:layer-new", createdAt: "2026-09-15 00:00:00", createdSince: "one minute ago", size: "2MB", comment: "release", commandKind: "run" }]
  });
  assert.deepEqual(historyResult.truncation, { truncated: true, reason: "row-limit", originalItemCount: 2, retainedItemCount: 1 });
  assert.doesNotMatch(JSON.stringify(historyResult), /never-visible|release=1\.5/);
});

test("fixtures retain valid empty image, history, and diff observations", async () => {
  const fixture = toolMap(createFixtureTools("insufficient-evidence"));
  const images = requiredTool(fixture, "docker_images");
  const imageResult = await images.execute(images.parseArguments({}), new AbortController().signal);
  assert.equal(imageResult.status, "success");
  assert.deepEqual(JSON.parse(imageResult.content), { images: [] });

  const history = requiredTool(fixture, "docker_history");
  const historyResult = await history.execute(history.parseArguments({ image_id: "checkout:latest" }), new AbortController().signal);
  assert.equal(historyResult.status, "success");
  assert.deepEqual(JSON.parse(historyResult.content), { history: [] });

  const diff = requiredTool(fixture, "docker_diff");
  const diffResult = await diff.execute(diff.parseArguments({ container_id: "checkout-api" }), new AbortController().signal);
  assert.equal(diffResult.status, "success");
  assert.deepEqual(JSON.parse(diffResult.content), { changes: [] });
});

test("writable-layer fixture projects diff and process observations while preserving uncertainty", async () => {
  const fixture = toolMap(createFixtureTools("writable-layer-change"));
  const diff = requiredTool(fixture, "docker_diff");
  const diffResult = await diff.execute(diff.parseArguments({ container_id: "checkout-api" }), new AbortController().signal);
  assert.equal(diffResult.status, "success");
  assert.deepEqual(JSON.parse(diffResult.content), {
    changes: [
      { action: "added", path: "/tmp/checkout-cache" },
      { action: "changed", path: "/var/lib/checkout/state.json" }
    ]
  });

  const top = requiredTool(fixture, "docker_top");
  const topResult = await top.execute(top.parseArguments({ container_id: "checkout-api" }), new AbortController().signal);
  assert.equal(topResult.status, "success");
  assert.deepEqual(JSON.parse(topResult.content), {
    headers: ["PID", "USER", "COMMAND"],
    processes: [{ fields: ["20", "app", "node server.js"] }]
  });

  const missing = await diff.execute(diff.parseArguments({ container_id: "missing" }), new AbortController().signal);
  assert.deepEqual(missing, { status: "error", code: "not-found", message: "Docker resource was not found.", retryable: false });
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
