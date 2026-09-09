# HolmesGPT TypeScript port: local Docker diagnostics scope and implementation plan

Date: September 8, 2026
Status: Selected scope; the repository contains an initial TypeScript skeleton
Working name: `holmes-ts` (a local development name, not a confirmed npm package name)

## 1. Objective

Port the complete **local Docker diagnostic** experience from HolmesGPT's Docker
toolset to a standalone TypeScript CLI. It must investigate a user's question
against one user-selected local Docker daemon/context, select its own read-only
Docker observations, and produce an evidence-backed diagnosis and remediation
guidance.

This replaces the earlier four-tool, exited-container MVP. “Full” here means
all prompts, tool contracts, execution behavior, and tests that are relevant to
the pinned upstream `docker/core` toolset—not all HolmesGPT integrations or the
entire Python application. The CLI remains local Docker focused.

Examples of supported questions include why a container exited, whether a
container is unhealthy, what changed in its writable filesystem, why an image
behaves unexpectedly, and which processes are running in a container.

## 2. Upstream baseline and compatibility promise

The authoritative source is HolmesGPT revision
[`5e983c17f30e93099c7d775167266d4cd1d586c4`](https://github.com/HolmesGPT/holmesgpt/tree/5e983c17f30e93099c7d775167266d4cd1d586c4).
The port map must pin this revision; upstream changes must not silently change
the TypeScript behavior.

The relevant upstream source material is:

- `holmes/plugins/toolsets/docker.yaml`: all nine `docker/core` tools.
- `holmes/plugins/prompts/generic_ask.jinja2`: model investigation rules.
- `holmes/plugins/prompts/base_user_prompt.jinja2` and
  `_toolsets_instructions.jinja2`: user/context and toolset prompt behavior.
- `holmes/core/tool_calling_llm.py`, `holmes/core/tools.py`, and their direct
  execution helpers: tool-call conversation and error semantics.

Port the semantic behavior, not Python implementation details or Jinja syntax.
Preserve the upstream tool names and their diagnostic intent. TypeScript may
use Docker's API or fixed `docker` argument arrays instead of the upstream
generic command executor, provided observable read behavior is compatible.

Upstream is Apache-2.0. Include its license and applicable attribution before
distribution. Every copied or adapted prompt/tool file must identify the source
path, revision, license, and substantive TypeScript changes.

## 3. Included local-Docker surface

### CLI, configuration, and target boundary

- `ask "<question>"` runs one bounded investigation.
- `--docker-context <name>` chooses exactly one Docker context. Resolve and
  display the default once at startup when omitted; include it in every Docker
  command.
- `--fixture <scenario>` replays observations through the same tool schemas and
  projections, without needing Docker.
- `--verbose` prints validated tool requests, durations, truncation, and
  evidence identifiers without revealing secrets.
- Use `LLM_API_KEY`, `LLM_MODEL`, and optional `LLM_BASE_URL` for one tested
  OpenAI-compatible provider. Do not attempt LiteLLM compatibility.

This port supports only a Docker daemon reachable from the local machine via
the selected context. It does not fan out across contexts or SSH into hosts.
“Local” describes the operator-controlled Docker endpoint, not necessarily a
Docker Desktop-only implementation.

### Full upstream `docker/core` tool inventory

| Upstream tool | TypeScript behavior | Diagnostic use |
|---|---|---|
| `docker_images` | List images with repository, tag, ID, creation time, size, and dangling state. | Missing/wrong image references and image inventory. |
| `docker_ps` | List running containers. | Discover active targets and state. |
| `docker_ps_all` | List all containers, including stopped ones. | Find exited, created, and historical targets. |
| `docker_inspect` | Inspect one validated container or image, projecting relevant structured fields. | State, health, exit details, command, mounts, networks, image config, and metadata. |
| `docker_logs` | Retrieve bounded timestamped logs for one validated container. | Application failures and runtime evidence. |
| `docker_top` | Show processes for one running container. | Hung processes, unexpected commands, and process presence. |
| `docker_events` | Retrieve a bounded historical event window, optionally narrowed to one validated container. | Start/stop/die/kill/health and daemon-side chronology. |
| `docker_history` | Show bounded layer history for one validated image reference/ID. | Provenance, unexpected layers, and image-size changes. |
| `docker_diff` | Show bounded added/changed/deleted writable-layer paths for one validated container. | Runtime filesystem mutation. |

The tool names above are the external compatibility contract. Preserve their
upstream singular resource parameters (`container_id`, `image_id`, or
`container_or_image_id`) where applicable; add only safe optional parameters
needed to bound output, such as log tail and event window.

Do not expose a generic shell, arbitrary Docker flags, model-controlled Docker
contexts, `docker exec`, attach, copy, build, pull, prune, stop, remove, or any
other write operation. Validate IDs/names/references and numeric bounds before
execution; reject flag-like input. Construct argument arrays in code, never a
shell command. Treat Docker output as untrusted evidence, never instructions.

`docker events` must be historical and deadline-bounded—never an unbounded
live stream. Each subprocess has a timeout capped by the remaining investigation
deadline. Project inspect data and redact environment-variable values, auth
material, and sensitive labels by default. Logs and filesystem paths can still
contain sensitive data; document that live evidence is sent to the selected
model provider.

### Prompt and investigation behavior

Create a local-Docker prompt port from the applicable upstream generic prompt:

- State that the agent is a Docker troubleshooting investigator that gathers
  evidence with tool calls.
- Prefer independent calls in parallel when the provider protocol and limits
  permit; preserve result-to-call identity even when execution is concurrent.
- Continue beyond a surface symptom to the deepest supported cause; use a
  five-whys approach where evidence links a container, image, or Docker event
  to another local Docker resource.
- Always inspect logs for an application/container problem when logs are
  available; inspect state and events for crash/lifecycle problems.
- Search for exact resources first, then make clearly labeled substring or
  similarly named-resource checks when necessary.
- Separate observed facts from hypotheses, reuse results, adjust empty queries
  instead of repeating them, and state inaccessible/missing evidence plainly.
- Offer specific, non-executed remediation when the evidence supports it.
- Keep the final response concise and avoid saying “based on the tool output.”

Do not port Kubernetes, cluster-awareness, external-observability,
skills, TodoWrite, permissions, ticketing, or disabled-toolset prompt blocks.
They have no local-Docker diagnostic meaning in this CLI.

The final answer must contain a finding, direct supporting evidence IDs,
recommended next steps, and uncertainty/missing evidence. Validate every cited
ID before rendering. Facts derived from logs, inspect fields, events, and
filesystem changes must remain distinguishable from model inference.

### Engine and reliability requirements

- Model-driven tool loop with multiple calls per response, structured tool
  result/error messages, matching call IDs, cancellation, and a final
  tools-disabled synthesis call when time permits.
- Defaults: 12 model calls, 24 tool calls, and a 180-second overall deadline;
  configure them for testing. The final synthesis call is reserved.
- Defaults: 10-second subprocess timeout, 30-second model timeout, 100 log
  lines, 100 resources/events/history/diff rows, 16,000 characters per result,
  and 96,000 characters of accumulated evidence. Explicitly mark truncation.
- Deduplicate identical calls after two unchanged results. On deadline,
  cancellation, provider failure, or exhausted budget, return a visibly partial
  result with the evidence collected so far.
- Run independent read calls concurrently with a small configurable concurrency
  limit. Never let a late result exceed the overall deadline or orphan a tool
  call in the provider conversation.

## 4. Explicit exclusions

- Kubernetes and every non-Docker built-in toolset (Prometheus, Grafana, cloud,
  databases, logging backends, ticketing, Slack, and web integrations).
- Generic YAML/Jinja toolset loading, Python configuration compatibility,
  plugin systems, MCP, browser/UI/server APIs, streaming UI, stored sessions,
  background monitoring, and multi-agent orchestration.
- Docker writes, image pulls/builds, `docker exec`, automated remediation,
  approval workflows, arbitrary shell access, multi-context investigation, and
  remote-host management.
- A promise of byte-for-byte prompt rendering, matching model wording, or
  matching tool-call order with Python HolmesGPT.

Docker networks, volumes, compose projects, daemon info, and configuration
files are not part of the pinned upstream `docker/core` toolset. Add them only
in a separately approved scope expansion with concrete diagnostic scenarios.

## 5. Target architecture

The following is the delivery target, not a claim that every listed file is
implemented today. See the README's current-layout section for the checked-in
skeleton and the status of each component.

```text
src/
  cli.ts                         Arguments, configuration, exit codes
  config.ts                      Provider, Docker context, and limits
  core/
    investigate.ts               Concurrent bounded model/tool loop
    types.ts                     Messages, calls, evidence, partial results
    evidence.ts                  IDs, citations, redaction, budgets
  llm/
    provider.ts                  Provider interface
    openai-compatible-provider.ts
  prompts/
    local-docker-investigate.ts  Adapted upstream prompt with attribution
  tools/
    registry.ts                  Schemas, validation, dispatch
    docker.ts                    Nine public tool definitions/projections
    docker-cli.ts                Fixed-array Docker CLI backend
    fixtures.ts                  Fixture implementation of all nine tools
  output/render.ts               Progress and evidence-backed answer
fixtures/
  missing-env/
  unhealthy-container/
  writable-layer-change/
  image-regression/
  insufficient-evidence/
tests/
  core/ tools/ prompts/ cli/
docs/
  quickstart.md
  upstream-port-map.md
  security-and-data-handling.md
```

The registry owns input validation and public schemas. The Docker backend owns
only execution and output projection. Fixtures share the public schemas,
redactors, projections, output budgets, and errors with live mode; they supply
only observations, never a prewritten diagnosis.

## 6. Evaluation and acceptance criteria

Bundle deterministic scripted-provider tests and real-model fixture evaluation.
The latter is a quality gate, not proof of general diagnostic correctness.

| Scenario | Required tool/evidence behavior | Required conclusion |
|---|---|---|
| Missing configuration | Locate exited container; inspect and read logs. | Identify the missing setting only when logs/state support it. |
| Unhealthy/running container | Discover, inspect health, inspect events, read logs. | Separate health symptom from supported cause. |
| Writable-layer mutation | Inspect container and use `docker_diff`; inspect processes/logs as relevant. | Identify observed changed paths without claiming their cause unless supported. |
| Image regression | Discover image/container; inspect image and call history. | Identify the relevant image/layer evidence and safe next checks. |
| Incomplete evidence | Handle no logs, missing resource, or failed event query. | State what is known and what cannot be established. |

Definition of done:

1. All nine tools execute against fixtures and a disposable local Docker demo;
   every tool has validation, timeout, redaction, output-bound, and error tests.
2. Tests prove no tool can add Docker flags, change context, invoke a shell, or
   issue a mutating Docker action.
3. Scripted-loop tests cover parallel/multiple calls, unknown tools, malformed
   arguments, matching call/result IDs, repeated calls, timeouts, cancellation,
   provider failures, result/evidence budgets, and final synthesis.
4. The adapted prompt has snapshot/semantic tests for the local-Docker rules
   above and an upstream port map documenting each included/omitted source block.
5. Each diagnostic fixture is run at least five times against the selected
   model. Successful runs cite relevant valid evidence, make no material
   unsupported claim, and meet the scenario's conclusion criterion. Record
   model, date, counts, latency, and available token usage.
6. At least one successful live investigation covers each capability class:
   container lifecycle/logs, running processes, image history, and filesystem
   diff. Document Docker Engine/Desktop version and context.
7. A clean checkout installs, type-checks, builds, and runs the documented
   fixture walkthrough with Node.js and model credentials; Python is not
   required. Real-model/live-Docker evidence is reported separately from mocks.

## 7. Delivery sequence

| Milestone | Deliverables | Exit condition |
|---|---|---|
| 1. Port specification | Complete port map, attribution, exact schemas, prompt adaptation, and provider spike. | One validated Docker tool call round trip with a real provider. |
| 2. Safe execution foundation | Registry, Docker CLI adapter, redaction, budgets, deadlines, cancellation, and loop. | Deterministic engine/security tests pass. |
| 3. Container lifecycle suite | `docker_ps`, `docker_ps_all`, `docker_inspect`, `docker_logs`, `docker_events`, and fixtures. | Live and fixture parity for crash/health cases. |
| 4. Image and runtime suite | `docker_images`, `docker_top`, `docker_history`, `docker_diff`, and fixtures. | Live and fixture parity for every remaining tool. |
| 5. Prompt/output quality | Final synthesis, citation validation, concise rendering, and real-model evaluations. | All fixture gates and partial-result behavior pass. |
| 6. Documentation/release | Quickstart, walkthrough, security/data handling, limits, port map, and license notices. | Fresh-checkout verification passes. |

Re-estimate after milestone 1. This is no longer a 7–9 day MVP: a reasonable
planning range is 15–22 engineering days for one developer, plus environment-
specific Docker and model-evaluation contingency.

## 8. Risks and decisions to retain

| Risk | Scope response |
|---|---|
| Upstream generic tool commands accept broader input than is safe | Preserve diagnostic coverage, but implement strictly validated argument schemas and fixed Docker arguments. |
| `docker events` can block forever | Require a historical window, bounded result count, subprocess timeout, and overall cancellation. |
| Inspect/log output leaks secrets | Project/redact known sensitive fields, bound content, warn users before live evidence leaves the machine. |
| Full HolmesGPT scope creeps in | The nine-tool Docker inventory and applicable prompt rules are the boundary; all other toolsets remain excluded. |
| Model stops at a symptom | Prompt rules, mandatory relevant logs/state checks, fixture gates, and evidence-citation review enforce deeper investigation. |

The first implementation task is milestone 1: write `docs/upstream-port-map.md`,
turn the nine upstream tools into exact TypeScript schemas, and prove one
end-to-end validated `docker_ps_all` call with the selected provider.
