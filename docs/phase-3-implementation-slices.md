# Phase 3 implementation slices — safe Docker lifecycle evidence

Date: September 11, 2026  
Status: ready to implement  
Prerequisite: Phase 2 evidence-safe engine at 8920e71

This document decomposes Phase 3 of the
[current-state implementation plan](current-state-implementation-plan.md) into
small, test-first slices. It adds the shared execution boundary and the
container-lifecycle portion of the local-Docker surface:

- docker_ps
- docker_ps_all
- docker_inspect
- docker_logs
- docker_events

It also adds the first three fixture scenarios: missing-env,
unhealthy-container, and insufficient-evidence. The Phase 2 investigation
engine remains the sole owner of evidence retention, supplied-secret
redaction, character budgets, deadlines, and model conversation history.

## Phase boundary and non-goals

Phase 3 establishes a narrow, injectable Docker command boundary and proves
that lifecycle observations are safe to expose to the engine. A model may
choose one of the already-registered tools and provide a validated resource or
bounded parameter; it never chooses an executable, a Docker context, a
subcommand, an arbitrary flag, or a shell expression.

Phase 3 does not add docker_images, docker_top, docker_history, or docker_diff;
image/runtime fixtures; renderer redesign; or real-model evaluation. Those are
Phase 4 and Phase 5 work. It must not introduce generic command execution,
docker exec, Docker writes, Docker API access, or unbounded event/log
streaming.

All deterministic unit and fixture tests must run without a Docker daemon. A
disposable Docker environment is used only for the final live-validation slice.

## Decisions frozen before implementation

| Concern              | Phase 3 decision                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Command authority    | Only an internal adapter invokes the literal docker executable through an argument array. It uses spawn/execFile-style execution, never a shell or command string.                                                                               |
| Context              | Fixture runs have no Docker context. A live run resolves the default context once with docker context show, or validates one explicit context once. The resolved name is pinned and inserted into every operational command as --context <name>. |
| Context validation   | Reject blank and flag-like CLI context values before process creation. Confirm an explicit context with a fixed docker context inspect <name> command. Do not expose this output as model evidence.                                              |
| Command results      | The adapter returns stdout, stderr, exit status, duration, and termination category. It does not create ToolExecutionResult values or provider-visible strings.                                                                                  |
| Timeout/cancellation | Every subprocess receives the engine-derived signal. The adapter enforces the smaller of subprocessTimeoutMs and the remaining signal deadline, terminates/drains the child, and maps the outcome without forwarding raw process errors.         |
| Output handling      | Docker-specific code parses and projects output before a success reaches ToolRegistry. Raw Docker output must not be placed in errors or verbose progress. Phase 2 still applies character and accumulated-evidence caps.                        |
| Sensitive fields     | Inspect projections omit environment values and auth material. Omit values for labels whose normalized key contains secret, token, password, passwd, credential, auth, or key; retain only a withheld marker.                                    |
| Resource limits      | Listing, event, and inspect-derived collection rows are capped at maxRowsPerResult; logs are capped at the validated tail and maxLogLines. Every cap has Truncation metadata.                                                                    |
| Events               | Events always carry both --since and --until; they never follow a live stream. Reject a window above a frozen safe maximum and one too far in the future.                                                                                        |
| Error vocabulary     | Normalize absent objects to not-found, daemon/connectivity failures to unavailable, process expiry to timeout, caller abort to cancelled, malformed output to malformed-output, and other nonzero exits to nonzero-exit.                         |
| Fixture parity       | Fixtures share public schemas, registry dispatch, projections, truncation semantics, and structured errors with live mode. Fixture data supplies observations, never a diagnosis.                                                                |

### Command construction rules

Centralize fixed command construction in one module. The command layer must not
accept a free-form argument array from a tool registration. The only variable
positions are validated resource values and bounded numeric/time values.

| Tool           | Fixed Docker operation                                                                                             | Bounded/model-selected values                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| docker_ps      | container ls --format <fixed-json-template>                                                                        | none                                                                                    |
| docker_ps_all  | container ls --all --format <fixed-json-template>                                                                  | none                                                                                    |
| docker_inspect | inspect <validated-id>                                                                                             | one validated container-or-image identifier                                             |
| docker_logs    | container logs --timestamps --tail <tail> <validated-id>                                                           | tail 1–100 and a validated container identifier                                         |
| docker_events  | events --since <since> --until <until> --format <fixed-json-template>, plus optional fixed --filter container=<id> | validated timestamps, optional validated container identifier; result cap after parsing |

Every operational command is prefixed with the startup-pinned context. Tests
must assert complete argument arrays, including ordering, not merely safe words.

## Slice sequence

| Slice                                            | Deliverable                                                                                                                 | Primary files                                                                                              | Completion criteria                                                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Docker process boundary                       | Add an injectable fixed-array Docker adapter and its result/error contract.                                                 | src/tools/docker-cli.ts, src/core/types.ts, src/tests/docker-cli.test.ts                                   | Adapter tests prove no shell is used, signal/timeout termination is deterministic, and raw process failures do not cross the adapter boundary. |
| 2. Context resolution and CLI wiring             | Resolve/pin a live context, keep fixture mode mutually exclusive, and expose safe verbose progress hooks.                   | src/tools/docker-cli.ts, src/config.ts, src/cli.ts, src/tests/cli.test.ts                                  | A context resolves once before registry construction; every live command uses it; fixture invocation starts no Docker process.                 |
| 3. Shared parsing, projection, and error mapping | Create reusable JSON-lines/table parsing, row limiting, safe metadata, inspect projection, and Docker-error classification. | src/tools/docker-projection.ts, src/tools/docker.ts, src/tests/docker-projection.test.ts                   | Raw fields cannot bypass redaction/projection; malformed, truncated, and nonzero outputs produce deterministic results.                        |
| 4. Container discovery tools                     | Implement docker_ps and docker_ps_all through live and fixture-compatible executors.                                        | src/tools/docker.ts, src/tools/fixtures.ts, src/tests/docker-tools.test.ts                                 | Exact commands, projection, row truncation, daemon failures, and fixture parity pass.                                                          |
| 5. Inspect tool                                  | Implement safe container/image inspect projection and missing-resource behavior.                                            | src/tools/docker.ts, src/tools/docker-projection.ts, src/tools/fixtures.ts, src/tests/docker-tools.test.ts | Secrets/raw configuration cannot reach content or metadata; container and image cases pass.                                                    |
| 6. Logs and events tools                         | Implement timestamped bounded logs and historical lifecycle events.                                                         | src/tools/docker.ts, src/tools/docker-projection.ts, src/tools/fixtures.ts, src/tests/docker-tools.test.ts | Logs never follow; events never stream; bounds and safe errors are covered.                                                                    |
| 7. Fixture scenarios and engine walkthroughs     | Add lifecycle fixture observations and scripted investigations through the real registry/tool path.                         | fixtures/*, src/tools/fixtures.ts, src/tests/fixture-investigations.test.ts                                | Required discovery → inspect → logs/events paths run without Docker or a provider.                                                             |
| 8. Documentation and deterministic gate          | Update current-availability/security documentation and run local checks.                                                    | README.md, docs/quickstart.md, docs/security-and-data-handling.md, docs/upstream-port-map.md               | Documentation is accurate and deterministic checks pass.                                                                                       |
| 9. Disposable live-Docker validation             | Exercise lifecycle tools against an intentionally broken local example and record environment facts.                        | examples/docker/*, docs/ validation record                                                                 | One local run covers discovery, inspect, logs, and bounded events without widening scope.                                                      |

## Implementation detail by slice

### 1. Docker process boundary

Add src/tools/docker-cli.ts as a low-level dependency, not a public tool
registry. Its input should be a closed internal operation type (or named
methods per operation), a pinned context, and an AbortSignal. Do not expose a
generic run(args: string[]) API to application code.

The adapter owns:

- locating/invoking only docker;
- process creation with argument arrays and no shell;
- bounded stdout/stderr capture;
- timer/signal composition, child termination, and cleanup;
- a neutral result that distinguishes completed, cancelled, timed-out, and
  nonzero processes.

It does not own JSON parsing, Docker semantic errors, tool schemas, evidence,
or verbose rendering. Keep executable location injectable in tests, but never
user/model configurable in the CLI.

Use a fake process launcher and controlled abort signals. Assert a request
cannot introduce a shell metacharacter, context override, mutation command, or
extra flag. Cover an already-aborted signal, subprocess timeout, caller
cancellation, nonzero completion, and a late child exit. A timeout must leave
no timer/listener that affects a later call.

### 2. Context resolution and CLI wiring

Add a narrow context resolver to the adapter layer. For a live invocation:

1. Parse and reject conflicting --fixture and --docker-context inputs.
2. Without an explicit context, execute fixed docker context show once and
   require a nonblank, non-flag-like result.
3. With an explicit context, validate it locally and then probe it with fixed
   docker context inspect <name>.
4. Store the resolved context as immutable startup state, then construct all
   live registrations from it.

Add --verbose. Its progress is human-oriented and safe: tool name, resource
kind (not raw output), elapsed duration, completion category, truncation reason,
and evidence ID if available. It must never print environment values, labels,
log bodies, stderr, API credentials, or raw inspection data.

Test parsing, explicit/default context paths, failed validation, and fixture
isolation with a fake adapter. A startup/context failure has one clear CLI
error; a tool-level daemon failure remains a structured engine observation.

### 3. Shared parsing, projection, and error mapping

Add a shared Docker projection module that accepts only captured adapter output
and returns normalized ToolExecutionResult values. Live and fixture
implementations use it. Keep Docker parsing out of core/evidence.ts and never
serialize raw JSON wholesale.

Implement:

- strict fixed-format Docker JSON-lines parsing, including blank-line handling
  and malformed-record errors;
- deterministic stable ordering and row/line limiting, with row-limit or
  line-limit counts;
- concise resource metadata with safe projected attributes;
- projectors for container rows, lifecycle events, logs, and inspect documents;
- Docker error classification with fixed/tested patterns, never raw stderr.

Inspect must use an explicit allowlist. Container projection includes only
identity, image reference/ID, command shape, state/health, timestamps, exit
status, restart-policy summary, mount/network summaries, and safe labels.
Image projection includes identifiers/tags, creation, architecture/OS,
entrypoint/command shape, and safe labels. Omit environment values, auth/config
history blobs, raw GraphDriver data, and arbitrary configuration blobs.

Use fixture-style inputs for every parser branch. Test credentials in
environment arrays and labels: they cannot occur in result content or metadata.
Prove row limiting occurs before the Phase 2 evidence-character cap and retains
its independent provenance.

### 4. Container discovery tools

Implement docker_ps and docker_ps_all first. Their Phase 1 schemas remain empty
objects and reject every model-supplied key.

Use a fixed JSON formatting template and parse each row. Project at least
container ID, name, image, command summary, created/status, and concise
state/health indicators where available. Do not parse human-oriented tables.
Limit retained rows to maxRowsPerResult, include count-based truncation, and
distinguish valid empty output from malformed output.

For both tools, test argument arrays, multiple/empty rows, malformed JSON, row
overflow, subprocess timeout/cancellation, daemon unavailable, and nonzero
output. Fixtures must share projectors, not duplicate result text.

### 5. Inspect tool

Replace docker_inspect's placeholder executor with one fixed inspect operation
for exactly one validated container_or_image_id. It may determine kind from the
returned document, but must not retry arbitrary alternate commands or add
flags derived from the model input.

Parse exactly one inspect object. An unexpected count, invalid JSON, or object
without kind markers is malformed-output. Normalize a missing target to
not-found; daemon/connectivity conditions to unavailable; other valid nonzero
exits to nonzero-exit.

Cover terminated/unhealthy containers, missing health, image metadata,
sensitive environments/labels/auth-like fields, non-ASCII content, and
flag-like targets. Fixture inspect passes through the same projector/error path.

### 6. Logs and events tools

Logs use --timestamps and the schema-validated tail. Do not add --follow,
--details, --since, arbitrary filters, or model-selected options. Split output
after collection, retain at most min(tail, maxLogLines), and mark line
truncation. Docker can emit logs on stderr in some configurations; handle that
deliberately without blindly making stderr provider-visible. Logs remain
untrusted evidence and are not heuristically secret-scanned beyond Phase 2
known-secret redaction.

Events use both timestamps and optional exact container filter. They are bounded
historical records, never live follows. Parse fixed JSON-lines records; project
time, type, action, actor/resource identity, and only safe attributes. Apply
requested/global row caps with truncation. Do not forward arbitrary event
attributes.

Test stopped/missing containers, no logs, timestamp ordering, future/oversized
windows, malformed events, row overflow, timeouts, cancellation, daemon
failures, and flag-injection prevention.

### 7. Fixture scenarios and engine walkthroughs

Migrate FixtureScenario from its placeholders to:

- missing-env
- unhealthy-container
- insufficient-evidence

Fixture construction returns all lifecycle registrations under the same schemas
as live mode. Store versioned structured observations under fixtures/ and pass
them through shared projectors. Each tool exposes only what its live counterpart
would return—not all fixture data at once.

| Scenario              | Expected tool path                                                                     | Required deterministic outcome                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Missing configuration | docker_ps_all → docker_inspect → docker_logs (and bounded events when relevant)        | Evidence establishes an exited target and missing-configuration signal; final text cites only retained evidence. |
| Unhealthy container   | docker_ps → docker_inspect → docker_events → docker_logs                               | Health is an observation; lifecycle/log evidence supports or limits causal explanation.                          |
| Insufficient evidence | discovery/inspect plus missing resource, empty output, or failed event/log observation | Result remains partial/uncertain and never manufactures a root cause.                                            |

Tests assert equivalent fixture/captured-live inputs produce matching success,
error, truncation, and metadata. They also prove fixtures need neither a Docker
binary nor context and preserve the Phase 2 citation/evidence constraints.

### 8. Documentation and deterministic gate

After functionality exists, update README, quickstart, security guidance, and
the upstream map. Document available lifecycle tools and absent Phase 4 tools;
Node/Docker prerequisites; context pinning and fixture/live exclusivity; the
10-second subprocess cap (subject to remaining investigation time); projections
and redaction limits; a no-daemon fixture walkthrough; and a distinctly labeled
live walkthrough.

Run npm run check and all deterministic tests without model credentials or
Docker. Keep the authenticated provider test separately identified: it is not
Docker validation.

### 9. Disposable live-Docker validation

Only after the deterministic gate, use a disposable example with one
crashed/misconfigured and one unhealthy/running container. Record Docker
Engine/Desktop version, OS, selected context, commands exercised, and result.
Do not commit raw inspect output or secret-bearing logs.

Demonstrate context resolution/pinning, discovery, inspect, timestamped bounded
logs, historical bounded events, and safe absent-resource/daemon failure
handling where the environment permits. This record supplements deterministic
tests; it does not replace Phase 5 real-model fixture evaluation.

## Deterministic test matrix

| Behavior             | Required assertion                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Process safety       | Adapter invokes only docker with fixed argument arrays and never a shell.                                                                     |
| Input isolation      | Flag-like IDs/contexts/timestamps and invalid numeric values fail before an adapter call; a model cannot change context or add a flag.        |
| Context pinning      | One live invocation resolves/validates context once; every operational command uses it; fixtures execute none.                                |
| Lifecycle projection | Lists, inspect, logs, and events contain only allowed fields; sensitive inspect values and untrusted event attributes cannot leak.            |
| Bounds               | Log lines and rows cap deterministically, with visible original/retained counts.                                                              |
| Process outcomes     | Timeout, abort, nonzero exit, daemon unavailable, missing resource, and malformed output become intended safe errors.                         |
| Fixture parity       | Equivalent fixture/captured-live input yields matching schema, safe content, metadata, and truncation/error category.                         |
| Engine integration   | Scripted lifecycle investigations preserve call IDs, evidence order/budgets, citation validation, duplicate suppression, and final synthesis. |
| CLI behavior         | Verbose progress is useful but redaction-safe; incompatible fixture/context options fail before investigation.                                |

## Recommended pull-request order

1. Docker process boundary and fake-launcher tests.
2. Context resolution and CLI wiring.
3. Projection/error module with pure tests.
4. Discovery tools and fixture parity.
5. Inspect projection and fixture parity.
6. Logs/events and limit/error tests.
7. Scenario fixtures and registry/engine walkthroughs.
8. Documentation and deterministic gate.
9. Recorded disposable live-Docker validation.

Each pull request should contain only directly related production changes and
deterministic tests. Do not start Phase 4 until the gate below passes.

## Phase 3 exit gate

- [ ] A single live Docker context resolves before tool construction and cannot
      be changed by a model/tool call.
- [ ] The adapter issues only fixed read-only Docker arrays and cannot use a
      shell, mutation command, or arbitrary flag.
- [ ] docker_ps, docker_ps_all, docker_inspect, docker_logs, and docker_events
      return projected, bounded, structured observations.
- [ ] Inspect removes environment values, auth material, and sensitive-label
      values; events do not forward arbitrary attributes.
- [ ] Logs are timestamped/bounded; events are historical/bounded; timeout,
      cancellation, malformed output, not-found, and daemon failures map
      safely.
- [ ] missing-env, unhealthy-container, and insufficient-evidence fixtures
      use the same registry/projection/error behavior without Docker.
- [ ] Deterministic adapter, projection, tool, fixture, CLI, and engine tests
      pass along with npm run check.
- [ ] A disposable live-Docker run records lifecycle validation without
      broadening the command surface.

Only after this gate is met may Phase 4 implement the image and runtime tools.
