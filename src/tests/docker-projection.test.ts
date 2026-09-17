import assert from "node:assert/strict";
import test from "node:test";
import type { DockerCommandResult, ToolExecutionResult, ToolSuccess } from "../core/types.js";
import {
  mapDockerCommandFailure,
  parseDiffLines,
  parseJsonLines,
  parseProcessTable,
  parseTable,
  projectContainerRows,
  projectDiffRows,
  projectEvents,
  projectImageHistory,
  projectImageRows,
  projectInspect,
  projectLogs,
  projectProcessRows
} from "../tools/docker-projection.js";

function completed(stdout: string, outputTruncated = false): DockerCommandResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 4, termination: "completed", outputTruncated };
}

test("JSON-lines parsing ignores blank lines and rejects every malformed record", () => {
  assert.deepEqual(parseJsonLines('\n{"ID":"a"}\n\r\n{"ID":"b"}\n'), [{ ID: "a" }, { ID: "b" }]);
  assert.throws(() => parseJsonLines('{"ID":"a"}\nnot-json'), /malformed output/);
  assert.throws(() => parseJsonLines('["not an object"]'), /malformed output/);
});

test("fixed table parsing requires its expected columns and complete rows", () => {
  assert.deepEqual(parseTable("ID  NAME\na1  api\nb2  worker\n", ["ID", "NAME"]), [
    { ID: "a1", NAME: "api" },
    { ID: "b2", NAME: "worker" }
  ]);
  assert.throws(() => parseTable("NAME  ID\napi  a1", ["ID", "NAME"]), /malformed output/);
  assert.throws(() => parseTable("ID  NAME\na1", ["ID", "NAME"]), /malformed output/);
});

test("container rows are allowlisted, sorted, and row-limited before evidence retention", () => {
  const result = projectContainerRows(
    completed(
      [
        JSON.stringify({ ID: "b", Names: "zebra", Image: "api:v2", Command: "serve", Status: "Up", State: "running", Env: "DB_PASSWORD=secret" }),
        JSON.stringify({ ID: "a", Names: "alpha", Image: "api:v1", Labels: { team: "platform", api_token: "do-not-leak" } })
      ].join("\n")
    ),
    "2026-09-15T12:00:00Z",
    1
  );
  const success = requiredSuccess(result);

  assert.equal(success.content, '{"containers":[{"id":"a","name":"alpha","image":"api:v1","labels":{"api_token":"<withheld>","team":"platform"}}]}');
  assert.deepEqual(success.truncation, { truncated: true, reason: "row-limit", originalItemCount: 2, retainedItemCount: 1 });
  assert.doesNotMatch(JSON.stringify(success), /do-not-leak|DB_PASSWORD/);
});

test("image rows are allowlisted, sorted, and independently row-limited", () => {
  const result = projectImageRows(
    completed(
      [
        JSON.stringify({
          Repository: "zebra",
          Tag: "v2",
          ID: "sha256:z",
          CreatedAt: "2026-09-15 12:00:00",
          CreatedSince: "one hour ago",
          Size: "12MB",
          Labels: { token: "hidden" }
        }),
        JSON.stringify({
          Repository: "<none>",
          Tag: "<none>",
          ID: "sha256:d",
          CreatedAt: "2026-09-15 11:00:00",
          CreatedSince: "two hours ago",
          Size: "8MB",
          Config: { password: "hidden" }
        }),
        JSON.stringify({ Repository: "alpha", Tag: "v1", ID: "sha256:a", CreatedAt: "2026-09-15 10:00:00", CreatedSince: "three hours ago", Size: "4MB" })
      ].join("\n")
    ),
    "2026-09-15T12:00:00Z",
    2
  );
  const success = requiredSuccess(result);

  assert.deepEqual(JSON.parse(success.content), {
    images: [
      { id: "sha256:d", createdAt: "2026-09-15 11:00:00", createdSince: "two hours ago", size: "8MB", dangling: true },
      { id: "sha256:a", repository: "alpha", tag: "v1", createdAt: "2026-09-15 10:00:00", createdSince: "three hours ago", size: "4MB", dangling: false }
    ]
  });
  assert.deepEqual(success.truncation, { truncated: true, reason: "row-limit", originalItemCount: 3, retainedItemCount: 2 });
  assert.doesNotMatch(JSON.stringify(success), /hidden/);
});

test("history allowlists values and retains Docker newest-to-oldest order", () => {
  const result = projectImageHistory(
    completed(
      [
        JSON.stringify({
          ID: "sha256:new",
          CreatedAt: "2026-09-15 12:00:00",
          CreatedSince: "one hour ago",
          CreatedBy: '/bin/sh -c #(nop)  CMD ["node" "server.js"]',
          Size: "0B",
          Comment: ""
        }),
        JSON.stringify({
          ID: "sha256:old",
          CreatedAt: "2026-09-15 10:00:00",
          CreatedSince: "three hours ago",
          CreatedBy: "/bin/sh -c RUN token=never-visible",
          Size: "4MB",
          Comment: "release note"
        })
      ].join("\n")
    ),
    "2026-09-15T12:00:00Z",
    1
  );
  const success = requiredSuccess(result);

  assert.deepEqual(JSON.parse(success.content), {
    history: [{ id: "sha256:new", createdAt: "2026-09-15 12:00:00", createdSince: "one hour ago", size: "0B", comment: "", commandKind: "cmd" }]
  });
  assert.equal(success.truncation?.reason, "row-limit");
  assert.doesNotMatch(JSON.stringify(success), /server\.js|never-visible/);
});

test("process tables preserve dynamic headers and fields while rejecting invalid layouts", () => {
  const result = projectProcessRows(completed("PID  USER  TIME  COMMAND\n20  app  0:01  node server.js\n10  root  0:02  sleep 1\n"), "2026-09-15T12:00:00Z", 1);
  const success = requiredSuccess(result);
  assert.deepEqual(JSON.parse(success.content), { headers: ["PID", "USER", "TIME", "COMMAND"], processes: [{ fields: ["10", "root", "0:02", "sleep 1"] }] });
  assert.equal(success.truncation?.reason, "row-limit");
  assert.throws(() => parseProcessTable("PID  PID\n1  2\n"), /malformed output/);
  assert.throws(() => parseProcessTable("PID  USER\n1\n"), /malformed output/);
  assert.throws(() => parseProcessTable("PID\u0000  USER\n1  app\n"), /malformed output/);
});

test("diff rows are normalized, sorted, and reject malformed paths", () => {
  const result = projectDiffRows(completed("C /var/lib/éclair\nD /tmp/file with spaces\nA /app/new\n"), "2026-09-15T12:00:00Z", 2);
  const success = requiredSuccess(result);
  assert.deepEqual(JSON.parse(success.content), {
    changes: [
      { action: "added", path: "/app/new" },
      { action: "deleted", path: "/tmp/file with spaces" }
    ]
  });
  assert.equal(success.truncation?.reason, "row-limit");
  assert.throws(() => parseDiffLines("X /app/file"), /malformed output/);
  assert.throws(() => parseDiffLines("A relative/file"), /malformed output/);
  assert.throws(() => parseDiffLines("A  /app/file"), /malformed output/);
});

test("new projectors reject malformed records and preserve capture truncation", () => {
  assert.deepEqual(projectImageRows(completed('{"Repository":"api"}', true), "2026-09-15T12:00:00Z", 100), {
    status: "error",
    code: "malformed-output",
    message: "Docker returned malformed output.",
    retryable: false
  });
  const history = requiredSuccess(
    projectImageHistory(
      completed(JSON.stringify({ ID: "a", CreatedAt: "now", CreatedSince: "now", CreatedBy: "RUN echo safe", Size: "0B", Comment: "" }), true),
      "2026-09-15T12:00:00Z",
      100
    )
  );
  assert.deepEqual(history.truncation, { truncated: true, reason: "character-limit" });
  assert.deepEqual(projectDiffRows(completed("A /safe\n\n"), "2026-09-15T12:00:00Z", 100), {
    status: "error",
    code: "malformed-output",
    message: "Docker returned malformed output.",
    retryable: false
  });
  const rows = Array.from({ length: 101 }, (_, index) => `A /app/${String(index).padStart(3, "0")}`).join("\n");
  const diff = requiredSuccess(projectDiffRows(completed(rows), "2026-09-15T12:00:00Z", 100));
  assert.equal(JSON.parse(diff.content).changes.length, 100);
  assert.deepEqual(diff.truncation, { truncated: true, reason: "row-limit", originalItemCount: 101, retainedItemCount: 100 });
});

test("inspect projection omits environment and raw config while withholding sensitive labels", () => {
  const result = projectInspect(
    completed(
      JSON.stringify([
        {
          Id: "container-id",
          Name: "/api",
          Created: "2026-09-15T10:00:00Z",
          State: {
            Status: "exited",
            ExitCode: 137,
            StartedAt: "2026-09-15T10:01:00Z",
            FinishedAt: "2026-09-15T10:02:00Z",
            Health: { Status: "unhealthy", Log: ["secret log"] }
          },
          Config: {
            Image: "api:v1",
            Entrypoint: ["node"],
            Cmd: ["server.js"],
            Env: ["PASSWORD=never-visible"],
            Labels: { owner: "checkout", "com.example.secret": "never-visible" }
          },
          HostConfig: { RestartPolicy: { Name: "on-failure" }, Privileged: true },
          Mounts: [{ Type: "volume", Source: "/private/secret", Destination: "/app", RW: false }],
          NetworkSettings: { Networks: { backend: { IPAddress: "10.0.0.2" } } }
        }
      ])
    ),
    "2026-09-15T12:00:00Z"
  );
  const success = requiredSuccess(result);

  assert.deepEqual(JSON.parse(success.content), {
    kind: "container",
    id: "container-id",
    name: "/api",
    imageReference: "api:v1",
    createdAt: "2026-09-15T10:00:00Z",
    state: "exited",
    health: "unhealthy",
    exitCode: 137,
    startedAt: "2026-09-15T10:01:00Z",
    finishedAt: "2026-09-15T10:02:00Z",
    restartPolicy: "on-failure",
    command: { entrypoint: ["node"], command: ["server.js"] },
    labels: { "com.example.secret": "<withheld>", owner: "checkout" },
    mounts: [{ type: "volume", destination: "/app", readOnly: true }],
    networks: { names: ["backend"] }
  });
  assert.doesNotMatch(JSON.stringify(success), /never-visible|secret log|private\/secret|10\.0\.0\.2|Privileged/);
});

test("image inspect projection exposes only image identity and command shape", () => {
  const result = projectInspect(
    completed(
      JSON.stringify([
        {
          Id: "sha256:image",
          RepoTags: ["api:v1"],
          Created: "2026-09-15T10:00:00Z",
          Architecture: "amd64",
          Os: "linux",
          Config: { Entrypoint: ["node"], Cmd: ["server.js"], Env: ["TOKEN=never-visible"], Labels: { release: "2026.09", api_key: "never-visible" } },
          RootFS: { Layers: ["secret"] }
        }
      ])
    ),
    "2026-09-15T12:00:00Z"
  );
  const success = requiredSuccess(result);

  assert.deepEqual(JSON.parse(success.content), {
    kind: "image",
    id: "sha256:image",
    tags: ["api:v1"],
    createdAt: "2026-09-15T10:00:00Z",
    architecture: "amd64",
    os: "linux",
    entrypoint: ["node"],
    command: ["server.js"],
    labels: { api_key: "<withheld>", release: "2026.09" }
  });
  assert.doesNotMatch(JSON.stringify(success), /never-visible|RootFS|secret/);
});

test("events and logs use independent deterministic item limits", () => {
  const events = requiredSuccess(
    projectEvents(
      completed(
        [
          JSON.stringify({
            timeNano: 20,
            Type: "container",
            Action: "die",
            Actor: { ID: "b", Attributes: { name: "api", image: "api:v1", password: "hidden" } }
          }),
          JSON.stringify({ timeNano: 10, Type: "container", Action: "start", Actor: { ID: "a", Attributes: { name: "worker" } } })
        ].join("\n")
      ),
      "2026-09-15T12:00:00Z",
      1
    )
  );
  assert.deepEqual(JSON.parse(events.content), { events: [{ timeNano: 10, type: "container", action: "start", resourceId: "a", resourceName: "worker" }] });
  assert.equal(events.truncation?.reason, "row-limit");

  const logs = requiredSuccess(projectLogs(completed("first\nsecond\nthird\n"), "2026-09-15T12:00:00Z", 2));
  assert.deepEqual(JSON.parse(logs.content), { lines: ["first", "second"] });
  assert.deepEqual(logs.truncation, { truncated: true, reason: "line-limit", originalItemCount: 3, retainedItemCount: 2 });
});

test("process failures map to fixed, non-secret errors", () => {
  assert.deepEqual(
    mapDockerCommandFailure({
      ...completed(""),
      exitCode: 1,
      termination: "nonzero-exit",
      stderr: "Error response from daemon: No such container: private-token"
    }),
    {
      status: "error",
      code: "not-found",
      message: "Docker resource was not found.",
      retryable: false
    }
  );
  assert.deepEqual(
    mapDockerCommandFailure({
      ...completed(""),
      exitCode: 1,
      termination: "nonzero-exit",
      stderr: "Cannot connect to the Docker daemon at unix:///private/socket"
    }),
    {
      status: "error",
      code: "unavailable",
      message: "Docker is unavailable.",
      retryable: true
    }
  );
  assert.deepEqual(
    mapDockerCommandFailure({
      ...completed(""),
      exitCode: 1,
      termination: "nonzero-exit",
      stderr: "failed to connect to the docker API at unix:///private/socket"
    }),
    {
      status: "error",
      code: "unavailable",
      message: "Docker is unavailable.",
      retryable: true
    }
  );
  assert.deepEqual(mapDockerCommandFailure({ ...completed(""), exitCode: null, termination: "timeout" }), {
    status: "error",
    code: "timeout",
    message: "Docker command timed out.",
    retryable: true
  });
});

test("malformed and capture-truncated output is represented without raw data", () => {
  assert.deepEqual(projectContainerRows(completed("{bad", true), "2026-09-15T12:00:00Z", 10), {
    status: "error",
    code: "malformed-output",
    message: "Docker returned malformed output.",
    retryable: false
  });
  const result = requiredSuccess(projectLogs(completed("partial", true), "2026-09-15T12:00:00Z", 10));
  assert.deepEqual(result.truncation, { truncated: true, reason: "character-limit" });
  assert.deepEqual(projectContainerRows(completed('{"unexpected":true}'), "2026-09-15T12:00:00Z", 10), {
    status: "error",
    code: "malformed-output",
    message: "Docker returned malformed output.",
    retryable: false
  });
});

function requiredSuccess(result: ToolExecutionResult): ToolSuccess {
  assert.equal(result.status, "success");
  return result;
}
