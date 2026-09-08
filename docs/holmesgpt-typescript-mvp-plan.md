# HolmesGPT TypeScript port: Docker diagnostics MVP scope and implementation plan

Date: September 8, 2026  
Status: Selected MVP scope; a TypeScript project skeleton is in place  
Working name: `holmes-ts` (local development name, not a confirmed npm package name)

## 1. Recommendation and objective

Build a small TypeScript CLI that answers a Docker troubleshooting question by collecting live evidence through tools and explaining the likely cause. Preserve HolmesGPT’s central investigation behavior: the model chooses what to inspect, receives tool results, and continues investigating before answering.

The first release should demonstrate one complete workflow:

> “Why did the checkout container exit?”

The agent discovers the container, inspects its state, reads relevant events and logs, and returns a diagnosis supported by those observations, with suggested next steps.

Start with **one model provider, four Docker tools, one-shot CLI investigations, and fixture-backed demos**. Use the same investigation engine for both fixtures and a local Docker daemon. Target approximately **7–9 engineering days for one developer** familiar with TypeScript and Docker, assuming a working model account and Docker Desktop or Docker Engine. This is an estimate, not a measured delivery commitment.

The repository contains the initial standalone Node.js package skeleton. This plan defines the work needed to make its Docker diagnostic flow operational; a browser UI is outside this MVP.

## 2. Porting baseline and compatibility boundary

The upstream reference is [HolmesGPT revision `5e983c17f30e93099c7d775167266d4cd1d586c4`](https://github.com/HolmesGPT/holmesgpt/tree/5e983c17f30e93099c7d775167266d4cd1d586c4), retrieved as `master` during planning. Pin that revision in the implementation notes so future upstream changes do not silently expand this scope.

The inspected upstream implementation separates the model/tool loop, tool contracts, execution, and Docker tool definitions. The TypeScript version should preserve those responsibilities while implementing a smaller set of behaviors. The existing Python implementation includes substantial functionality beyond the proposed MVP, including streaming, approval handling, and extensible YAML tools. Sources: [investigation loop](https://github.com/HolmesGPT/holmesgpt/blob/5e983c17f30e93099c7d775167266d4cd1d586c4/holmes/core/tool_calling_llm.py), [tool contracts and execution](https://github.com/HolmesGPT/holmesgpt/blob/5e983c17f30e93099c7d775167266d4cd1d586c4/holmes/core/tools.py), and [Docker tools](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/docker/).

| Upstream responsibility | TypeScript MVP treatment |
|---|---|
| Model-driven investigation loop | Reimplement tool selection, tool-result feedback, completion, and bounded execution. |
| Tool definitions and structured results | Implement typed interfaces, argument validation, a registry, and consistent errors. |
| Docker diagnostics | Implement four purpose-built read tools through `docker`. |
| CLI entry point and configuration | Implement a minimal `ask` command, environment configuration, and progress output. |
| Prompts and tool descriptions | Adapt only the instructions needed for the selected scenarios; record copied or modified material. |
| Full configuration, APIs, plugins, and integrations | Defer; no compatibility promise for upstream YAML, CLI flags, HTTP endpoints, or result schemas. |

This release is a behavioral subset. It must run without Python or a HolmesGPT Python service. Validate observable behavior and evidence quality; identical model wording and tool-call order are not requirements.

Upstream currently carries Apache-2.0. Include the license and applicable attribution for reused material, mark adapted files, and check the pinned tree for any applicable notices before distributing the port. See the [pinned upstream license](https://github.com/HolmesGPT/holmesgpt/blob/5e983c17f30e93099c7d775167266d4cd1d586c4/LICENSE).

## 3. Included scope

### CLI and configuration

- `ask "<question>"` starts one investigation and prints the final answer.
- `--docker-context` selects the Docker context; resolve the default once at startup and display it.
- `--fixture <scenario>` uses bundled observations without requiring Docker. It still uses the real model to select tools and generate the answer.
- `--verbose` displays tool names, validated arguments, durations, and bounded results for demonstration and debugging.
- Use `LLM_API_KEY`, `LLM_MODEL`, and an optional `LLM_BASE_URL` for the first provider adapter. Never commit credentials.
- Provide concise errors for missing configuration, unavailable Docker, an inaccessible Docker daemon, provider failures, and invalid arguments.

Implement one adapter for a selected endpoint supporting OpenAI-compatible tool calling. The provider and model remain configurable, but the MVP only claims support for the endpoint/model combination exercised by its acceptance tests. Do not build a replacement for LiteLLM. Record the tested combination and lock dependency versions in milestone 1.

### Four diagnostic tools

| Tool | Inputs | Evidence returned |
|---|---|---|
| `list_containers` | Optional name filter | Container IDs, names, image, status, state, and creation time. |
| `inspect_container` | Validated container ID or name | Selected state, exit code, image, command, health, mounts, and environment-variable names. |
| `get_container_logs` | Validated container ID or name; bounded tail count | Timestamped current logs. |
| `get_container_events` | Validated container ID or name; fixed bounded time window | Start, stop, kill, die, and health-status events. |

Keep the tools narrow. The registry must not expose arbitrary shell commands, Docker write commands, `docker exec`, model-controlled Docker contexts, or arbitrary Docker flags. Construct `docker` argument arrays in code and run them without a shell. Validate container identifiers and parameters before execution. Preserve the selected Docker context on every command.

Use the local Docker daemon or configured Docker context for live mode. The application’s tool restrictions do not reduce privileges granted by Docker socket access, so document that the CLI is intended for a user-controlled development environment. The upstream Docker integration is read-only. [Docker tool documentation](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/docker/)

### Investigation and result behavior

- Send the question, investigation instructions, and available tool schemas to the model.
- Validate each requested tool call, execute it, and attach a matching result to the conversation.
- Support multiple tool calls in one model response; execute them sequentially for the MVP.
- Return structured errors to the model so it can recover or explain missing evidence.
- Give each result an evidence ID such as `E1`, with its tool, resource, and collection time.
- Render a final answer with: finding, supporting evidence IDs, suggested next steps, and missing evidence or uncertainty.
- Validate that cited evidence IDs exist. Assess whether the evidence supports the diagnosis in demo evaluations; ID validity alone does not establish correctness.
- Display suggested remediation as text. Do not execute it.

Maintain conversation state only for the duration of the command. Token streaming, follow-up chat, persisted history, and server APIs are deferred.

### Small but necessary execution limits

Start with configurable defaults of 8 model calls, 12 executed tool calls, and a 120-second investigation deadline. Reserve the last model call for synthesis with tools disabled if time remains. On a hard deadline, cancellation, or provider failure, return a clearly marked partial result and the observations already collected.

Use a 10-second timeout per subprocess and a 30-second timeout per model request, each capped by the remaining overall deadline. Cancel outstanding work on Ctrl+C. Stop identical tool requests after two executions with unchanged results.

Bound raw subprocess buffers and model-facing output. Start with 100 log lines, 50 containers/events, 16,000 characters per tool result, and 64,000 characters of accumulated tool evidence. Mark truncation explicitly and stop collecting when the accumulated budget is exhausted. Verify during the provider spike that the complete prompt, schemas, question, evidence, and reserved answer fit the selected model’s context window. These character limits are engineering defaults, not exact token estimates.

Project Docker JSON into the fields needed for diagnosis; omit literal environment-variable values and unrelated labels. Logs can still contain sensitive information, so use synthetic data for the bundled demo and document that live observations are sent to the configured model. Treat log/event text as evidence, not as instructions to the agent.

## 4. Explicit exclusions

The following are post-MVP work and must not delay the demo:

- Web UI, TUI framework, HTTP service, streaming transport, and authentication.
- Interactive follow-up chat, saved sessions, memory, and databases.
- Prometheus, Grafana, Loki, cloud, ticketing, Slack, and other integrations.
- MCP client/server support and general plugin loading.
- Arbitrary YAML/Jinja toolsets and Python configuration compatibility.
- Multiple provider adapters or broad endpoint compatibility testing.
- Docker writes, `docker exec`, automatic remediation, approvals, and background monitoring.
- Remote Docker hosts, multi-context investigation, image builds, and general root-cause coverage.
- Advanced context compaction, vector search, multi-agent orchestration, and production tracing infrastructure.

## 5. Proposed architecture

Use a single package with a small explicit asynchronous investigation loop. Recommended baseline: Node.js 24 LTS, TypeScript with strict checking, npm with a committed lockfile, a small CLI parser, a schema validator, and the chosen provider’s supported JavaScript client. Node.js 24 is listed as LTS in the [official release table](https://nodejs.org/en/about/previous-releases). Confirm and pin concrete dependency versions at implementation time.

```text
src/
  cli.ts                     Arguments, configuration, exit codes
  config.ts                  Validated environment and scope
  core/
    investigate.ts           Model/tool loop, limits, cancellation
    types.ts                 Messages, tool calls, results, evidence
  llm/
    provider.ts              Small provider interface
    compatible-provider.ts   First tested provider adapter
  tools/
    registry.ts              Tool definitions and argument validation
    docker.ts                Four tool definitions and result projection
    docker-cli.ts            Live observation backend
    fixtures.ts              Fixture observation backend
  prompts/
    investigate.ts           Investigation and answer instructions
  output/
    render.ts                Progress, evidence references, final answer
fixtures/
  missing-env/
  unavailable-image/
  insufficient-evidence/
examples/
  docker/                    Demo service and Docker Compose configuration
tests/
  core/                      Scripted-model loop and failure tests
  tools/                     Arguments, projection, limits, fixture parity
docs/
  quickstart.md
  upstream-port-map.md
```

Keep three internal seams: a model provider returning assistant text/tool calls, a tool registry validating and dispatching calls, and a Docker observation backend implemented by either fixtures or the Docker CLI. Use plain typed messages/results so later integrations can reuse the engine.

The fixture backend must share the tool schemas and result projection with live mode. It supplies observations only; expected diagnoses belong in evaluation files and must not be given to the agent.

## 6. Demonstration and expected usage

The commands below describe the planned interface; they are not implemented yet.

```bash
# Once the implementation exists:
npm ci
npm run build

# Supply LLM_API_KEY and LLM_MODEL in the environment.
# A real model investigates bundled observations; no Docker daemon is needed.
node dist/cli.js ask "Why did checkout exit?" --fixture missing-env

# Investigate the local Docker daemon or a named Docker context.
node dist/cli.js ask "Why did checkout exit?" \
  --docker-context desktop-linux --verbose
```

| Scenario | Observations | Required conclusion |
|---|---|---|
| Primary: missing application configuration | Exited container; inspect shows a non-zero exit code; log says `Required environment variable APP_MODE is missing`. | Identify missing `APP_MODE` as the supported cause; cite inspect and log evidence; recommend updating the container configuration. |
| Secondary: unavailable image tag | Container/image inspection shows a missing or unavailable tag. | Identify the failed image/tag from evidence; recommend checking the reference and registry availability. |
| Incomplete evidence | A container exited, but relevant logs or events are unavailable. | State the observed failure and the missing information; avoid claiming an established root cause. |

Deliver a documented 3–5 minute walkthrough: run the primary fixture, show the model-selected calls and evidence, then repeat the primary case against a disposable local Docker Compose environment. Bundle a small TypeScript service that deliberately exits when `APP_MODE` is absent. Demo setup and cleanup are separate, manually invoked operations; the agent remains read-only.

Automated tests use a scripted model with no network or credentials. The user-facing fixture demo uses the actual model. Passing scripted tests is not evidence that a real model can diagnose the scenarios.

## 7. Implementation milestones

| Milestone | Estimate | Deliverables and exit condition |
|---|---|---|
| 1. Establish the port boundary and provider spike | 1 day | Scaffold the package, pin the upstream revision, record attribution, define interfaces, and select/pin the provider/model. Complete one real tool-call/result round trip. |
| 2. Build the investigation engine | 2 days | Implement registry, argument validation, messages, evidence IDs, errors, limits, cancellation, and final synthesis. Scripted-model tests pass for multi-step and multi-tool responses. |
| 3. Add Docker observations | 1–2 days | Implement all four tools, subprocess execution, Docker-context binding, output projection, and fixtures. Verify live commands against the disposable demo environment. |
| 4. Complete the CLI experience | 1 day | Wire `ask`, fixture selection, environment configuration, progress, verbose output, and readable findings. The primary fixture runs end to end with the real model. |
| 5. Evaluate and harden the demo | 1–2 days | Run all three scenarios with the selected model; address unsupported conclusions, invalid arguments, truncation, timeouts, and Docker-daemon failures. Demonstrate the primary live container. |
| 6. Package and document | 1 day | Finish quickstart, demo manifests, port map, limitations, and validation results. Build and run from a fresh checkout without Python. |
| Contingency | 0–2 days | Provider behavior, Docker platform/context differences, or model reliability fixes. |

Sequence milestones in that order. Recheck the estimate after milestone 1. The first useful preview is the fixture investigation at milestone 4; it is not the completed MVP until live operation and the acceptance checks pass.

## 8. Definition of done

The MVP is complete when all of the following hold:

1. A fresh checkout can install, build, and run the documented fixture demo with Node.js and a model API key; Python is unnecessary.
2. The agent selects tools from the question and observations. Diagnoses and fixed tool sequences are not hardcoded into the runtime.
3. Both failure fixtures pass at least 4 of 5 real-model runs each. A passing run identifies the supported cause, cites valid relevant evidence, proposes useful next steps, and introduces no material unsupported facts. Record the model, date, counts, latency, and token usage when available.
4. All 5 real-model runs of the incomplete-evidence fixture explicitly state the limitation and avoid presenting an unverified cause as established. This small suite is a demo gate, not a general accuracy benchmark.
5. At least one successful live investigation of the bundled exited-container demo produces the same substantive diagnosis as its fixture equivalent.
6. Scripted tests cover unknown tools, malformed arguments, multiple tool calls, matching call/result IDs, repeated calls, timeouts, cancellation, provider failures, truncated output, and exhausted budgets. No call is left without a corresponding result in a conversation sent back to the provider.
7. Tool tests verify fixed read commands, consistent Docker context, rejected flag-like or invalid container arguments, no shell execution, and bounded outputs. No mutating operation is exposed.
8. Evidence references resolve to collected results. Partial investigations are visibly distinct from completed ones. Exit codes distinguish completion, incomplete investigation, and setup/runtime failure.
9. Type checking, the production build, and deterministic tests pass. Real-model and live-Docker results are documented separately from mocked tests.
10. The quickstart, 3–5 minute walkthrough, configuration reference, attribution, and explicit compatibility limitations are included.

## 9. Risks and subsequent releases

| Risk | MVP response |
|---|---|
| Scope expands into a full Python feature port | Keep the four-tool boundary and the milestone exit conditions; queue integrations separately. |
| Model chooses poor tools or invents a cause | Use realistic tool descriptions, evidence requirements, repeated-call limits, and real-model evaluations. |
| Fixtures conceal Docker-daemon problems | Share schemas/projection and require a live primary-scenario demonstration. |
| Context/output grows unexpectedly | Enforce buffers, result limits, total evidence limits, and explicit partial completion. |
| Upstream changes during development | Track the pinned revision and document deliberate differences. |

After the MVP, prioritize one extension based on demo feedback: in-memory follow-up chat, a second data source such as Prometheus, or a small HTTP interface for application embedding. Add broader provider support and upstream YAML compatibility only when a concrete use case needs them. Remediation should be a separately scoped release with an explicit execution and permission model.

The first implementation task is milestone 1: create the standalone package, settle the internal contracts, and prove a real model can request one validated tool and consume its result.
