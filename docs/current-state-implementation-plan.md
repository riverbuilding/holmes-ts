# Current-state implementation plan

Date: September 9, 2026  
Status: proposed implementation sequence

## Purpose

This document turns the selected local-Docker scope in
[the MVP plan](holmesgpt-typescript-mvp-plan.md) into an ordered delivery plan
based on the code currently checked in. It is intentionally limited to the
pinned HolmesGPT `docker/core` port: nine read-only Docker tools, one selected
Docker context, fixtures, and an OpenAI-compatible model provider.

The authoritative upstream baseline remains commit
`5e983c17f30e93099c7d775167266d4cd1d586c4`. This plan does not expand the
scope to Kubernetes, generic shell access, Docker writes, or multi-context
investigations.

## Baseline assessment

`npm test` and `npm run check` pass on September 9, 2026. That verifies a
compiling skeleton and one deterministic investigation-loop test; it does not
verify an investigation can run.

| Area | Present today | Gap to delivery target |
|---|---|---|
| CLI/configuration | `ask`, a quoted positional question, `--docker-context`, three fixture names, and required model environment variables parse. | No `--verbose`, no selected-context resolution/display, no limit configuration, and fixture names do not match the five planned scenarios. |
| Model provider | Interfaces and an OpenAI-compatible class seam exist. | `respond` always throws; HTTP protocol mapping, timeouts, cancellation, and tool-call parsing are absent. |
| Investigation engine | A sequential model/tool loop associates successful tool results with `E1`, `E2`, etc.; unknown tools and tool errors become tool messages. | It lacks concurrent calls, per-call/model timeouts, global deadline propagation, evidence/result budgets, redaction, deduplication, reserved final synthesis, structured assistant tool-call history, citation validation, and useful partial synthesis. Defaults are 8 model calls, 12 tool calls, and 120 seconds rather than 12, 24, and 180 seconds. |
| Docker tools | Construction seam and context type exist. | All nine public tools, argument schemas, fixed Docker command backend, projections, redaction, bounded output, and error mapping are absent. |
| Fixtures | Construction seam and three placeholder scenario names exist. | No observation data or tool implementations; required scenarios for health, filesystem change, and image regression are absent. |
| Prompt/output | A short investigator prompt and a renderer exist. | No upstream attribution/adapted behavior, tool descriptions, partial-result guidance, or citation validation. |
| Quality/release | One scripted test passes. | There are no security, backend, fixture-parity, CLI, prompt, live-Docker, or real-model evaluation tests; attribution/license notices are also absent. |

Consequently, no live or fixture diagnostic path should be advertised as
working until phases 1 through 4 have passed.

## Delivery principles

- Build the shared schema, projection, redaction, and output-budget path before
  adding a live Docker command. Fixtures must exercise that same path.
- Keep model input separate from command execution. The model selects only a
  declared tool and validated arguments; application code selects the fixed
  Docker executable, context, flags, deadline, and output limits.
- Add narrow deterministic tests with each capability. A working manual Docker
  command is not an adequate security or compatibility test.
- Treat a tool failure, exhausted budget, cancellation, or provider failure as
  evidence of an incomplete investigation, not an uncaught CLI error.
- Keep the upstream commit and Apache-2.0 attribution adjacent to adapted
  prompts and tool semantics. Do not copy upstream material without a source
  header and a distribution notice.

### Terms used in this plan

- **Resource:** a Docker object that a tool can target. The two target resource
  types in this scope are a **container** (identified by name or ID) and an
  **image** (identified by reference or ID). `docker_inspect` can target either;
  the other tools target the applicable one of those types. Event records and
  filesystem-diff paths are evidence returned by tools, not independently
  targetable resources.
- **Subprocess:** a separate operating-system process started by this CLI,
  normally one fixed-argument `docker` command. The planned 10-second
  subprocess timeout bounds an individual Docker command; it is separate from
  the 30-second timeout for an HTTP call to the model provider and is also
  capped by the remaining 180-second investigation deadline.

## Phased implementation

### Phase 1 — freeze contracts and make the provider round trip

**Goal:** establish stable external contracts before implementation fans out.

1. Expand `src/core/types.ts` into the single contract for provider messages,
   assistant tool calls, tool results/errors, evidence metadata, truncation,
   and investigation limits. Include model, tool, subprocess, result, and
   accumulated-evidence limits; use the planned defaults (12 model calls, 24
   tool calls, 180 seconds, 30-second model timeout, 10-second subprocess
   timeout, 100 rows/log lines, 16,000 characters per result, and 96,000 total
   evidence characters).
2. Define the nine public tool JSON schemas and parsers in the registry layer.
   Preserve upstream names and singular parameter names:
   `docker_images`, `docker_ps`, `docker_ps_all`, `docker_inspect`,
   `docker_logs`, `docker_top`, `docker_events`, `docker_history`, and
   `docker_diff`. Add only bounded optional parameters, such as log tail or
   event window.
3. Write reusable validators for resource identifiers/references, numeric
   bounds, timestamps/windows, and optional filters. Reject unknown keys,
   flag-like values, empty identifiers, invalid counts, and any request that
   could select a context.
4. Implement `OpenAiCompatibleProvider` with the chosen OpenAI-compatible
   endpoint protocol. Map system/user/assistant/tool messages and tool schemas
   losslessly, preserve provider call IDs, honor abort signals and a model
   timeout, and return useful normalized provider errors without including the
   API key.
5. Port the local-Docker investigation prompt into
   `src/prompts/local-docker-investigate.ts`, including an attribution header.
   It must require evidence gathering, logs for application/container issues,
   state/events for lifecycle issues, fact-versus-inference separation,
   specific non-executed remediation, valid evidence citations, and stated
   uncertainty. Replace the current minimal prompt rather than maintaining two
   sources of truth.
6. Complete `docs/upstream-port-map.md` with each source block's destination,
   adaptations, omissions, and exact schema references. Add Apache-2.0 license
   and notice material before distributing source adapted from upstream.

**Tests and exit criteria**

- Unit-test every schema accept/reject case, especially flag injection and
  numeric bounds.
- Use a local mock HTTP server to prove a provider request maps a tool call and
  result round trip correctly, including malformed provider data, timeout, and
  cancellation cases.
- Manually perform one authenticated provider call only after the deterministic
  tests pass; do not use a Docker command in this phase.

### Phase 2 — bounded, evidence-safe investigation engine

**Goal:** make orchestration correct before tools can collect live evidence.

1. Refactor `investigate` so each provider response is retained with its
   structured tool calls, and every tool result/error has the matching call ID.
2. Create `src/core/evidence.ts` for deterministic evidence IDs, known-secret
   redaction, character clipping, truncation annotations, total-evidence
   accounting, and citation extraction/validation.
3. Derive child abort signals from the overall deadline for every provider and
   tool invocation. A tool timeout must use the smaller of its own timeout and
   the time remaining; late results must be ignored safely.
4. Execute independent calls from one model response concurrently with a small
   configurable limit, while appendending tool results in deterministic call
   order. This preserves tool-call/result identity even if completion order
   differs.
5. Add repeated-call tracking. After two unchanged results for an identical
   normalized request, return a structured duplicate result instead of calling
   Docker again.
6. Reserve one model call for a tools-disabled final synthesis whenever time
   permits. On cancellation, provider failure, deadline, or budget exhaustion,
   render a partial response containing the collected evidence and the exact
   reason.
7. Reject or visibly mark final-answer citations that do not correspond to
   collected evidence. The renderer should distinguish observed evidence from
   the model's conclusion and list truncation/partial status.

**Tests and exit criteria**

- Scripted-provider tests cover multiple concurrent calls, unknown and malformed
  calls, matching IDs, tool errors, duplicate suppression, per-call timeout,
  global deadline, cancellation, provider failure, model/tool limits, evidence
  clipping, and valid/invalid citations.
- No test may depend on Docker or a real model. All legacy loop behavior remains
  covered by the expanded tests.

### Phase 3 — shared Docker execution foundation and lifecycle tools

**Goal:** safely deliver the most useful container failure investigation path.

1. Add `src/tools/docker-cli.ts`, an injectable adapter that invokes only the
   `docker` executable using argument arrays (`spawn`/`execFile`), never a
   shell. It always supplies the startup-selected context, accepts no arbitrary
   flags, captures stdout/stderr separately, and enforces the child deadline.
2. Resolve the default Docker context once at startup when none is specified,
   display it, and pin it for the full investigation. Validate an explicit
   `--docker-context` before accepting it. Add `--verbose` progress that
   reports requests, durations, evidence IDs, and truncation without printing
   secret values.
3. Implement shared Docker JSON/table parsing, stable resource names, bounded
   row selection, and projection/redaction. Project inspect data instead of
   forwarding raw output; environment values, auth data, and sensitive-label
   values must be removed or masked.
4. Implement `docker_ps`, `docker_ps_all`, `docker_inspect`, `docker_logs`,
   and `docker_events`. Events must require a historical, bounded window and a
   result cap; it must never become a live stream. Ensure logs have timestamps
   and a tail cap.
5. Map Docker absent-resource, daemon-unavailable, malformed-output, timeout,
   and nonzero-exit cases to structured, non-secret tool errors.
6. Build fixture data and a fixture adapter for `missing-env`,
   `unhealthy-container`, and `insufficient-evidence`. Fixtures return the same
   schemas, projections, redaction, result budgets, truncation flags, and
   errors as the live path; fixture data supplies observations only.

**Tests and exit criteria**

- Adapter tests assert exact argument arrays include one fixed context and
  cannot contain user/model-derived flags or mutating subcommands.
- Per-tool tests cover happy path, absent resource, output truncation, timeout,
  redaction, invalid input, and daemon errors.
- Fixture scripts verify the required discovery → inspect → logs/events evidence
  sequence for crash and health questions.
- One disposable local-Docker demonstration validates lifecycle, logs, and
  historical events with the selected Docker Engine/Desktop version recorded.

### Phase 4 — image and runtime diagnostic tools

**Goal:** complete the planned nine-tool `docker/core` surface.

1. Add `docker_images` with repository, tag, ID, creation time, size, and
   dangling state.
2. Add `docker_top` for one validated running container, with bounded process
   rows and clear handling when a target is stopped.
3. Add `docker_history` for one validated image reference/ID, with bounded
   layer rows and projected layer metadata.
4. Add `docker_diff` for one validated container, with bounded added/changed/
   deleted path rows. Treat paths as untrusted evidence and do not infer their
   cause solely from the diff.
5. Add `writable-layer-change` and `image-regression` fixture scenarios, and
   align `FixtureScenario`, parser validation, CLI usage, README, and
   quickstart with all five scenarios. Remove or rename the current
   `unavailable-image` placeholder only as part of that aligned migration.

**Tests and exit criteria**

- Every remaining tool has schema, command-construction, projection,
  redaction, timeout, result-bound, and error tests.
- Fixture parity tests cover image regression and writable-layer mutation.
- A disposable live Docker environment demonstrates processes, image history,
  and filesystem diff. Together with Phase 3, this covers every capability
  class in the MVP plan.

### Phase 5 — answer quality, evaluations, and release readiness

**Goal:** verify that the model uses the safe tool surface to produce useful,
evidence-backed output.

1. Complete the terminal renderer: clearly label complete/partial status,
   finding, evidence list, recommended next steps, uncertainty/missing
   evidence, and invalid citation warnings. Do not silently repair a claim.
2. Add semantic/snapshot tests for the adapted prompt and renderer, including
   mandatory logs/state/events behavior and fact-versus-inference wording.
3. Run every fixture scenario at least five times using the selected real model.
   Record model identifier, date, prompt/version hash, run count, latency,
   available token usage, cited evidence, conclusion outcome, and unsupported
   claims in a versioned evaluation report.
4. Resolve material prompt, schema, projection, or engine failures exposed by
   the evaluations, then rerun the affected scenario set. A model result is
   accepted only when it cites relevant valid evidence and satisfies the
   scenario criterion without material unsupported claims.
5. Update quickstart, security guidance, `.env.example`, and README to state
   what works, the concrete limits, live-evidence data flow, fixture walkthrough,
   Node/Docker prerequisites, and command exit behavior. Add a clean-checkout
   verification script or documented sequence.

**Tests and exit criteria**

- A clean checkout can install, type-check, build, run all deterministic tests,
  and execute the documented fixture walkthrough with model credentials.
- Real-model evaluation and live-Docker records are clearly distinguished from
  deterministic test results.
- All definition-of-done items in the MVP plan have traceable test/report
  evidence.

## File-level change map

| File or path | Planned responsibility |
|---|---|
| `src/config.ts` | Read provider/Docker/limit settings; validate and expose safe defaults. |
| `src/cli.ts` | Parse complete CLI surface, resolve/pin context, construct dependencies, select exit codes, and manage verbose progress. |
| `src/core/types.ts` | Stable normalized contracts and complete limits. |
| `src/core/investigate.ts` | Deadline-aware concurrent tool loop and final synthesis behavior. |
| `src/core/evidence.ts` | Evidence IDs, redaction, clipping, budgets, and citation validation. |
| `src/llm/openai-compatible-provider.ts` | HTTP adapter, normalized protocol mapping, timeout, and cancellation. |
| `src/prompts/local-docker-investigate.ts` | Attributed local-Docker prompt port; replaces `prompts/investigate.ts`. |
| `src/tools/registry.ts` | Public schemas, parsing, validation, and dispatch. |
| `src/tools/docker-cli.ts` | Fixed-array, read-only Docker CLI adapter. |
| `src/tools/docker.ts` | Nine definitions plus Docker-specific projection coordination. |
| `src/tools/fixtures.ts` and `fixtures/*` | Scenario observations through the same public tool contracts. |
| `src/output/render.ts` | Validated, evidence-backed terminal output and partial-status display. |
| `src/tests/*` | Split deterministic core, provider, tool, prompt, CLI, and fixture tests by concern. |
| `examples/docker/*` | Disposable local Docker cases used only for live validation. |

## Suggested execution order and estimate

Implement phases 1 → 2 → 3 → 4 → 5 in order. Within a phase, tests should be
committed with the feature they verify. Phase 3 must not begin by directly
calling raw Docker output from the model; the adapter, schema, and projection
boundaries are prerequisites.

For one engineer, retain the MVP plan's preliminary range of **15–22 engineering
days**, then re-estimate after Phase 1. The main sources of contingency are the
selected provider's tool-call protocol, local Docker context differences, and
the quality iterations required by real-model fixture evaluations.

## Completion checklist

- [ ] All nine Docker tools are implemented with exact schemas and only fixed,
      read-only Docker argument arrays.
- [ ] One selected Docker context is resolved once and used for every command.
- [ ] Every live tool and fixture path applies validation, timeout, redaction,
      result limits, evidence limits, and structured errors.
- [ ] The investigation loop supports concurrency, cancellation, deduplication,
      reserved final synthesis, partial results, and citation validation.
- [ ] The five fixture scenarios and disposable live cases cover the required
      diagnostic behavior.
- [ ] Deterministic tests, real-model evaluations, and live-Docker validation
      meet the MVP plan's acceptance criteria.
- [ ] Documentation, Apache-2.0 attribution/notices, and a clean-checkout
      walkthrough are complete.
