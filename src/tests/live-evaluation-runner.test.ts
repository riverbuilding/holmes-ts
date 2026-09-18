import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantResponse, DockerCommandResult, Message, ToolDefinition } from "../core/types.js";
import { liveEvaluationCase } from "../live-evaluation/cases.js";
import { runLiveEvaluation } from "../live-evaluation/runner.js";
import type { LlmProvider } from "../llm/provider.js";
import type { DockerCliOperation, DockerContext } from "../tools/docker-cli.js";

test("live evaluation runner executes the YAML setup and cleanup around a real Docker-tool registry", async () => {
  const scripts: Array<{ phase: string; script: string }> = [];
  const result = await runLiveEvaluation(liveEvaluationCase("restart-loop"), {
    provider: new RestartLoopProvider(),
    dockerCli: {
      async resolveContext(): Promise<DockerContext> {
        return "test-context" as DockerContext;
      },
      async execute(operation: DockerCliOperation): Promise<DockerCommandResult> {
        switch (operation.kind) {
          case "container-ls":
            return completed(JSON.stringify({ ID: "restart-loop", Names: "holmes-e2e-restart-loop", Image: "alpine:3.21", State: "exited", Status: "Exited (1)" }));
          case "inspect":
            return completed(JSON.stringify([{ Id: "restart-loop", Name: "/holmes-e2e-restart-loop", State: { Status: "exited", ExitCode: 1 }, Config: { Image: "alpine:3.21" }, HostConfig: { RestartPolicy: { Name: "on-failure" } } }]));
          case "container-logs":
            return completed("2026-09-18T00:00:00.000000000Z Error: listen EADDRINUSE: address already in use 0.0.0.0:8080");
          default:
            throw new Error(`Unexpected Docker operation: ${operation.kind}`);
        }
      }
    },
    async runScript(script, _cwd, _signal, phase) {
      scripts.push({ phase, script });
    },
    async review() {
      return { decision: "pass", rationale: "All expected elements are present." };
    }
  });

  assert.equal(result.investigation.complete, true);
  assert.deepEqual(result.investigation.citationValidation.invalidEvidenceIds, []);
  assert.deepEqual(scripts.map((entry) => entry.phase), ["setup", "cleanup"]);
  assert.match(scripts[0]?.script ?? "", /docker run/);
  assert.match(scripts[1]?.script ?? "", /docker rm/);
});

class RestartLoopProvider implements LlmProvider {
  public async respond(messages: readonly Message[], _tools: readonly ToolDefinition[], _signal: AbortSignal): Promise<AssistantResponse> {
    const calls = messages.filter((message) => message.role === "assistant").length;
    if (calls === 0) return call("docker_ps_all", {});
    if (calls === 1) return call("docker_inspect", { container_or_image_id: "holmes-e2e-restart-loop" });
    if (calls === 2) return call("docker_logs", { container_id: "holmes-e2e-restart-loop", tail: 10 });
    return {
      content: "Finding\nThe container repeatedly fails with EADDRINUSE [E1] [E2] [E3].\nEvidence\nThe state and logs show the failure [E1] [E2] [E3].\nNext steps\nCheck the listener configuration.\nUncertainty\nThe observations do not show why the address is already in use.",
      toolCalls: []
    };
  }
}

function call(name: string, arguments_: object): AssistantResponse {
  return { content: `Calling ${name}.`, toolCalls: [{ id: `call-${name}`, name, arguments: arguments_ }] };
}

function completed(stdout: string): DockerCommandResult {
  return { stdout, stderr: "", exitCode: 0, durationMs: 0, termination: "completed", outputTruncated: false };
}
