import assert from "node:assert/strict";
import test from "node:test";
import type { DockerCommandResult, ToolSuccess } from "../core/types.js";
import { mapDockerCommandFailure, parseJsonLines, parseTable, projectContainerRows, projectEvents, projectInspect, projectLogs } from "../tools/docker-projection.js";

function completed(stdout: string, outputTruncated = false): DockerCommandResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 4, termination: "completed", outputTruncated };
}

test("JSON-lines parsing ignores blank lines and rejects every malformed record", () => {
  assert.deepEqual(parseJsonLines("\n{\"ID\":\"a\"}\n\r\n{\"ID\":\"b\"}\n"), [{ ID: "a" }, { ID: "b" }]);
  assert.throws(() => parseJsonLines("{\"ID\":\"a\"}\nnot-json"), /malformed output/);
  assert.throws(() => parseJsonLines("[\"not an object\"]"), /malformed output/);
});

test("fixed table parsing requires its expected columns and complete rows", () => {
  assert.deepEqual(parseTable("ID  NAME\na1  api\nb2  worker\n", ["ID", "NAME"]), [
    { ID: "a1", NAME: "api" }, { ID: "b2", NAME: "worker" }
  ]);
  assert.throws(() => parseTable("NAME  ID\napi  a1", ["ID", "NAME"]), /malformed output/);
  assert.throws(() => parseTable("ID  NAME\na1", ["ID", "NAME"]), /malformed output/);
});

test("container rows are allowlisted, sorted, and row-limited before evidence retention", () => {
  const result = projectContainerRows(completed([
    JSON.stringify({ ID: "b", Names: "zebra", Image: "api:v2", Command: "serve", Status: "Up", State: "running", Env: "DB_PASSWORD=secret" }),
    JSON.stringify({ ID: "a", Names: "alpha", Image: "api:v1", Labels: { team: "platform", api_token: "do-not-leak" } })
  ].join("\n")), "2026-09-15T12:00:00Z", 1);
  const success = requiredSuccess(result);

  assert.equal(success.content, "{\"containers\":[{\"id\":\"a\",\"name\":\"alpha\",\"image\":\"api:v1\",\"labels\":{\"api_token\":\"<withheld>\",\"team\":\"platform\"}}]}");
  assert.deepEqual(success.truncation, { truncated: true, reason: "row-limit", originalItemCount: 2, retainedItemCount: 1 });
  assert.doesNotMatch(JSON.stringify(success), /do-not-leak|DB_PASSWORD/);
});

test("inspect projection omits environment and raw config while withholding sensitive labels", () => {
  const result = projectInspect(completed(JSON.stringify([{
    Id: "container-id", Name: "/api", Created: "2026-09-15T10:00:00Z",
    State: { Status: "exited", ExitCode: 137, StartedAt: "2026-09-15T10:01:00Z", FinishedAt: "2026-09-15T10:02:00Z", Health: { Status: "unhealthy", Log: ["secret log"] } },
    Config: { Image: "api:v1", Entrypoint: ["node"], Cmd: ["server.js"], Env: ["PASSWORD=never-visible"], Labels: { owner: "checkout", "com.example.secret": "never-visible" } },
    HostConfig: { RestartPolicy: { Name: "on-failure" }, Privileged: true },
    Mounts: [{ Type: "volume", Source: "/private/secret", Destination: "/app", RW: false }],
    NetworkSettings: { Networks: { backend: { IPAddress: "10.0.0.2" } } }
  }])), "2026-09-15T12:00:00Z");
  const success = requiredSuccess(result);

  assert.deepEqual(JSON.parse(success.content), {
    kind: "container", id: "container-id", name: "/api", imageReference: "api:v1", createdAt: "2026-09-15T10:00:00Z",
    state: "exited", health: "unhealthy", exitCode: 137, startedAt: "2026-09-15T10:01:00Z", finishedAt: "2026-09-15T10:02:00Z",
    restartPolicy: "on-failure", command: { entrypoint: ["node"], command: ["server.js"] },
    labels: { "com.example.secret": "<withheld>", owner: "checkout" }, mounts: [{ type: "volume", destination: "/app", readOnly: true }], networks: { names: ["backend"] }
  });
  assert.doesNotMatch(JSON.stringify(success), /never-visible|secret log|private\/secret|10\.0\.0\.2|Privileged/);
});

test("image inspect projection exposes only image identity and command shape", () => {
  const result = projectInspect(completed(JSON.stringify([{
    Id: "sha256:image", RepoTags: ["api:v1"], Created: "2026-09-15T10:00:00Z", Architecture: "amd64", Os: "linux",
    Config: { Entrypoint: ["node"], Cmd: ["server.js"], Env: ["TOKEN=never-visible"], Labels: { release: "2026.09", api_key: "never-visible" } }, RootFS: { Layers: ["secret"] }
  }])), "2026-09-15T12:00:00Z");
  const success = requiredSuccess(result);

  assert.deepEqual(JSON.parse(success.content), {
    kind: "image", id: "sha256:image", tags: ["api:v1"], createdAt: "2026-09-15T10:00:00Z", architecture: "amd64", os: "linux",
    entrypoint: ["node"], command: ["server.js"], labels: { api_key: "<withheld>", release: "2026.09" }
  });
  assert.doesNotMatch(JSON.stringify(success), /never-visible|RootFS|secret/);
});

test("events and logs use independent deterministic item limits", () => {
  const events = requiredSuccess(projectEvents(completed([
    JSON.stringify({ timeNano: 20, Type: "container", Action: "die", Actor: { ID: "b", Attributes: { name: "api", image: "api:v1", password: "hidden" } } }),
    JSON.stringify({ timeNano: 10, Type: "container", Action: "start", Actor: { ID: "a", Attributes: { name: "worker" } } })
  ].join("\n")), "2026-09-15T12:00:00Z", 1));
  assert.deepEqual(JSON.parse(events.content), { events: [{ timeNano: 10, type: "container", action: "start", resourceId: "a", resourceName: "worker" }] });
  assert.equal(events.truncation?.reason, "row-limit");

  const logs = requiredSuccess(projectLogs(completed("first\nsecond\nthird\n"), "2026-09-15T12:00:00Z", 2));
  assert.deepEqual(JSON.parse(logs.content), { lines: ["first", "second"] });
  assert.deepEqual(logs.truncation, { truncated: true, reason: "line-limit", originalItemCount: 3, retainedItemCount: 2 });
});

test("process failures map to fixed, non-secret errors", () => {
  assert.deepEqual(mapDockerCommandFailure({ ...completed(""), exitCode: 1, termination: "nonzero-exit", stderr: "Error response from daemon: No such container: private-token" }), {
    status: "error", code: "not-found", message: "Docker resource was not found.", retryable: false
  });
  assert.deepEqual(mapDockerCommandFailure({ ...completed(""), exitCode: 1, termination: "nonzero-exit", stderr: "Cannot connect to the Docker daemon at unix:///private/socket" }), {
    status: "error", code: "unavailable", message: "Docker is unavailable.", retryable: true
  });
  assert.deepEqual(mapDockerCommandFailure({ ...completed(""), exitCode: 1, termination: "nonzero-exit", stderr: "failed to connect to the docker API at unix:///private/socket" }), {
    status: "error", code: "unavailable", message: "Docker is unavailable.", retryable: true
  });
  assert.deepEqual(mapDockerCommandFailure({ ...completed(""), exitCode: null, termination: "timeout" }), {
    status: "error", code: "timeout", message: "Docker command timed out.", retryable: true
  });
});

test("malformed and capture-truncated output is represented without raw data", () => {
  assert.deepEqual(projectContainerRows(completed("{bad", true), "2026-09-15T12:00:00Z", 10), {
    status: "error", code: "malformed-output", message: "Docker returned malformed output.", retryable: false
  });
  const result = requiredSuccess(projectLogs(completed("partial", true), "2026-09-15T12:00:00Z", 10));
  assert.deepEqual(result.truncation, { truncated: true, reason: "character-limit" });
  assert.deepEqual(projectContainerRows(completed("{\"unexpected\":true}"), "2026-09-15T12:00:00Z", 10), {
    status: "error", code: "malformed-output", message: "Docker returned malformed output.", retryable: false
  });
});

function requiredSuccess(result: ReturnType<typeof projectContainerRows> | ReturnType<typeof projectEvents> | ReturnType<typeof projectLogs> | ReturnType<typeof projectInspect>): ToolSuccess {
  assert.equal(result.status, "success");
  return result;
}
