import assert from "node:assert/strict";
import test from "node:test";
import { createAskRegistry, formatVerboseProgress, parseAskArguments, type AskArguments } from "../cli.js";
import { loadConfig } from "../config.js";
import type { DockerContext } from "../tools/docker-cli.js";
import type { ToolRegistration } from "../core/types.js";

const config = loadConfig({ LLM_API_KEY: "test-key" });

test("ask parsing rejects fixture and Docker context together, and accepts verbose", () => {
  assert.throws(
    () => parseAskArguments(["ask", "what happened?", "--fixture", "missing-env", "--docker-context", "dev"]),
    /cannot be used together/
  );
  assert.deepEqual(parseAskArguments(["ask", "what happened?", "--verbose"]), {
    question: "what happened?", verbose: true
  });
  assert.equal(
    parseAskArguments(["ask", "what changed?", "--fixture", "image-regression"]).fixture,
    "image-regression"
  );
  assert.equal(
    parseAskArguments(["ask", "what changed?", "--fixture", "writable-layer-change"]).fixture,
    "writable-layer-change"
  );
});

test("a live context resolves once before Docker registrations are constructed", async () => {
  const calls: Array<string | undefined> = [];
  const order: string[] = [];
  const progress: string[] = [];
  const dockerCli = {
    async resolveContext(context: string | undefined): Promise<DockerContext> {
      order.push("resolve");
      calls.push(context);
      return "team-dev" as DockerContext;
    },
    async execute(): Promise<never> { throw new Error("not used during startup"); }
  };
  const arguments_ = parseAskArguments(["ask", "what happened?", "--docker-context", "team-dev", "--verbose"]);

  await createAskRegistry(arguments_, config, {
    dockerCli,
    createDockerTools(scope) {
      order.push("construct");
      assert.equal(scope.context, "team-dev");
      assert.equal(scope.cli, dockerCli);
      assert.equal(scope.commandTimeoutMs, 10_000);
      return [];
    },
    reportProgress(event) { progress.push(formatVerboseProgress(event)); }
  });

  assert.deepEqual(calls, ["team-dev"]);
  assert.deepEqual(order, ["resolve", "construct"]);
  assert.deepEqual(progress, ["Docker context resolved: team-dev"]);
});

test("fixture startup does not consult or launch the Docker adapter", async () => {
  let dockerUsed = false;
  let fixtureUsed = false;
  const arguments_: AskArguments = parseAskArguments(["ask", "what happened?", "--fixture", "missing-env", "--verbose"]);

  await createAskRegistry(arguments_, config, {
    dockerCli: {
      async resolveContext(): Promise<DockerContext> {
        dockerUsed = true;
        return "must-not-be-used" as DockerContext;
      },
      async execute(): Promise<never> { throw new Error("not used during fixture startup"); }
    },
    createDockerTools() {
      dockerUsed = true;
      return [];
    },
    createFixtureTools() {
      fixtureUsed = true;
      return [] as ToolRegistration[];
    }
  });

  assert.equal(dockerUsed, false);
  assert.equal(fixtureUsed, true);
});

test("verbose rendering accepts only safe progress metadata", () => {
  assert.equal(formatVerboseProgress({
    kind: "tool-complete", toolName: "docker_logs", resourceKind: "container", durationMs: 12,
    completion: "completed", truncated: true, evidenceId: "E4"
  }), "Docker tool docker_logs resource=container durationMs=12 completion=completed truncated=true evidence=E4");
});
