# Phase 4 implementation slices — safe Docker image and runtime evidence

Date: September 15, 2026
Completed: September 16, 2026

Status: completed

Prerequisite met: Phase 3 lifecycle exit gate, including its recorded
live-Docker validation at `dbf134f`

This document records the completed Phase 4 implementation of the
[current-state implementation plan](current-state-implementation-plan.md) into
small, test-first slices. It completed the planned read-only `docker/core`
surface by implementing the four registrations intentionally left unavailable
after Phase 3:

- `docker_images`
- `docker_top`
- `docker_history`
- `docker_diff`

It also added the `image-regression` and `writable-layer-change` fixture
scenarios. The Phase 2 engine remains the sole owner of evidence retention,
known-secret redaction, character budgets, deadlines, provider history, and
citation validation. Phase 3's fixed-array Docker adapter remains the sole
process-execution boundary.

## Phase boundary and non-goals

Phase 4 adds only four fixed read operations to the existing pinned-context
Docker CLI boundary. A model may select one registered tool and provide only
its schema-validated identifier or bounded limit. It never selects an
executable, context, subcommand, `ps` option, format string, arbitrary flag,
or shell expression.

This phase does not add `docker exec`, Docker writes, Docker API access,
container/image creation, registry access, build inspection, live streams,
arbitrary process filters, renderer redesign, or real-model evaluation. Those
remain out of scope or belong to Phase 5. It also must not modify the existing
lifecycle-tool behavior except where a shared projection or fixture contract
must be migrated for the newly implemented tools.

All deterministic unit and fixture tests run without a Docker daemon. The
disposable Docker environment is used only after the deterministic exit gate
for the final live-validation slice.

## Implemented decisions

| Concern | Phase 4 decision |
|---|---|
| Execution boundary | Extend `DockerCliOperation` with a closed operation for each new read. `DockerCli` still invokes only `docker` through an argument array with `shell: false`; registrations never supply argv. |
| Context | Every live operation is prefixed with the one startup-pinned `--context <name>`. Fixture runs construct no `DockerCli` and launch no process. |
| Image discovery | `docker_images` executes one fixed `docker image ls --format {{json .}}` operation. It accepts no arguments, including no all-images flag, filter, or format override. |
| Process listing | `docker_top` executes one fixed `docker container top <validated-container-id>` operation. It accepts no model-selected `ps` options; a stopped or absent target maps to a safe structured error. |
| Image history | `docker_history` executes one fixed `docker image history --format {{json .}} <validated-image-id>` operation. Its only model-selected value is the validated image reference/ID; the requested result limit is enforced after parsing. |
| Writable-layer diff | `docker_diff` executes one fixed `docker container diff <validated-container-id>` operation. It has no filters, archive access, follow behavior, or filesystem mutation capability. |
| Output handling | Each projector consumes captured adapter output and emits projected content before a success reaches `ToolRegistry`. Raw stdout/stderr never appears in a provider-visible error or verbose progress. Adapter capture limits and Phase 2 evidence limits remain in force. |
| Projection | Image rows expose repository, tag, ID, creation time/age, size, and a derived dangling state. Process rows expose a validated header plus bounded field arrays, without pretending Docker's platform-dependent table is a stable schema. History exposes identity, creation, size, comment, and a derived command kind rather than raw build-command text. Diff exposes only a normalized added/changed/deleted action and its path. |
| Untrusted content | Process arguments, comments, and paths are untrusted observations, never instructions. Do not use a diff path or history row alone to infer a root cause. Do not serialize raw JSON documents, raw build commands, arbitrary table fields, or Docker error text. Existing evidence redaction still applies to supplied known secrets. |
| Limits and ordering | All list-like results use the existing maximum of 100 retained rows. Apply row limiting before Phase 2 evidence clipping and retain count-based truncation metadata. Use one explicitly tested stable ordering per tool. |
| Errors | Reuse the Phase 3 error vocabulary: `not-found`, `unavailable`, `timeout`, `cancelled`, `malformed-output`, and `nonzero-exit`. Add only fixed, tested classification patterns required for a stopped-container `docker_top` response; never forward stderr. |
| Fixture parity | Fixtures use the public tool schemas and the exact same projector/error path as live mode. Fixture data supplies captured-format observations, not diagnoses or pre-rendered tool results. |

### Implemented command construction

Centralize all new argv construction in `src/tools/docker-cli.ts`. The command
layer must not accept a free-form argument array. The variable positions below
are the complete set of model-controlled values after validation.

| Tool | Fixed Docker operation | Bounded/model-selected values |
|---|---|---|
| `docker_images` | `image ls --format {{json .}}` | none |
| `docker_top` | `container top <container>` | one validated container identifier |
| `docker_history` | `image history --format {{json .}} <image>` | one validated image reference/ID; result limit 1–100 |
| `docker_diff` | `container diff <container>` | one validated container identifier |

Every operational command is prefixed with the startup-pinned context. Tests
must assert complete argument arrays, including the fixed format string and
ordering, rather than merely assert that safe words appear.

## Completion record

| Slice | Delivered work | Primary files | Verification |
|---|---|---|---|
| 1. Command and projection foundation | Extended the closed CLI-operation union and added shared parsers/projectors. | `src/tools/docker-cli.ts`, `src/tools/docker-projection.ts`, `src/tests/docker-cli.test.ts`, `src/tests/docker-projection.test.ts` | Complete pinned-context argv arrays, parser failures, safe projections, stable ordering, and independent row truncation are covered deterministically. |
| 2. Image inventory and history | Implemented `docker_images` and `docker_history` through the live registry and shared projections. | `src/tools/docker.ts`, `src/tools/docker-projection.ts`, `src/tests/docker-tools.test.ts` | Both tools return structured projected observations; schema compatibility and success/failure cases pass. |
| 3. Runtime processes and filesystem diff | Implemented `docker_top` and `docker_diff` through the live registry and shared projections. | `src/tools/docker.ts`, `src/tools/docker-projection.ts`, `src/tests/docker-tools.test.ts` | Arbitrary process/filter options remain unavailable; table/diff parsing, stopped/missing behavior, bounds, and safe errors pass. |
| 4. Fixture-contract migration and scenarios | Migrated versioned fixture observations and added `image-regression` and `writable-layer-change`. | `src/tools/fixtures.ts`, `fixtures/*`, `src/tests/docker-tools.test.ts`, `src/tests/fixture-investigations.test.ts` | All five fixtures expose every implemented tool through shared schemas/projectors without Docker; walkthroughs demonstrate supported evidence paths and uncertainty. |
| 5. Documentation and deterministic gate | Updated availability, security, upstream-map, and quickstart documentation; completed the deterministic gate. | `README.md`, `docs/quickstart.md`, `docs/security-and-data-handling.md`, `docs/upstream-port-map.md` | Documentation describes all nine active tools and concrete limits; checks and tests pass without a Docker daemon for deterministic coverage. |
| 6. Disposable live-Docker validation | Extended the credential-free Compose example and recorded a safe live validation. | `examples/docker/*`, `docs/phase-4-live-docker-validation.md` | The completed disposable run demonstrated image inventory/history, process listing, and filesystem diff through the pinned context without recording raw sensitive evidence. |

## Implementation detail by slice

The following implementation requirements are retained as the design record
for the completed work.

### 1. Command and projection foundation

Add four named variants to the closed `DockerCliOperation` union and construct
their argument arrays in the existing `commandArguments` switch. Preserve the
adapter's existing timeout, cancellation, bounded capture, context, and
no-shell semantics. Do not introduce a generic `run(args)` method or an
operation type that accepts arbitrary flags.

Add narrowly scoped projector helpers rather than placing Docker parsing in
the registry or core evidence layer:

- Parse image-list and image-history output as strict fixed-format JSON lines.
  Reject malformed records, blank-but-nonempty values that cannot be projected,
  and unexpected field types. Empty output is a valid empty result.
- Project image rows through an allowlist. Normalize Docker's untagged
  placeholders into a derived `dangling` boolean; do not expose arbitrary
  labels, inspect configuration, or raw source records.
- Parse `docker top` as a Docker table with one non-empty header row and
  complete data rows. Preserve header names and each row's bounded field array
  so Linux, macOS, and daemon variations are represented honestly rather than
  coerced into an invented fixed process schema. Reject control characters,
  duplicate/blank headers, and incomplete rows.
- Project history through an allowlist. Derive a command category such as
  `run`, `copy`, `entrypoint`, `cmd`, or `other` from Docker's
  `CreatedBy` representation, but do not expose the raw text because it can
  contain build arguments, source paths, or credentials.
- Parse a diff line strictly as one Docker action marker (`A`, `C`, or
  `D`), a single separator, and a non-empty absolute path. Map the marker to
  `added`, `changed`, or `deleted`; reject malformed lines and control
  characters.
- Define and test deterministic sort keys. Image rows sort by repository, tag,
  then ID; history retains Docker's newest-to-oldest order; process rows sort
  by their full projected fields; diff rows sort by path, then action.

The projectors must call the existing process-failure mapper before parsing,
preserve adapter capture truncation when row limiting did not already produce
truncation, and return `malformed-output` rather than a thrown parse error.
Use fixture-style captured output to test malformed records, empty results,
non-ASCII values, 101 rows, capture truncation, nonzero failures, subprocess
timeout, and cancellation. Prove raw stderr and rejected raw fields are absent
from content and metadata.

### 2. Image inventory and history

Replace the `docker_images` placeholder with a live executor that accepts an
empty object only and uses the fixed image-list operation. It must share the
row cap and JSON-lines parser with history without allowing model-selected
filters, repository names, or format strings.

Replace the `docker_history` placeholder with a live executor using the
existing `image_id` parser and its default/validated `limit`. The execution
operation accepts only the validated image reference. Apply the requested limit
after projection and preserve a `row-limit` count when more layers were
available.

Tests must cover complete operations and contexts, empty image inventory,
multiple repositories/tags, dangling images, malformed JSON, history ordering,
limit overflow, image not found, daemon unavailable, timeout, cancellation,
and output capture truncation. Include a sensitive-looking `CreatedBy` value
and verify neither it nor raw command text reaches success content or metadata.
Also prove the public schemas and parser rejections for unknown properties,
flag-like identifiers, and limits above 100 remain unchanged.

### 3. Runtime processes and filesystem diff

Replace the `docker_top` placeholder with a live executor for one validated
container identifier. The model cannot supply `ps` arguments, filters, or a
format string. Treat a Docker response for a stopped target as a structured,
non-secret error with a clear fixed message and code; if Docker emits an
unrecognized nonzero response, retain the existing `nonzero-exit` behavior.

Replace the `docker_diff` placeholder with a live executor for one validated
container identifier. Project only action/path pairs. Empty output is a valid
observation that no writable-layer changes were returned; it is not evidence
that the application is healthy or unchanged in every relevant location.

Tests must cover exact operation/context construction, successful process
tables on at least two header layouts, malformed/misaligned tables, process
row overflow, stopped and missing containers, daemon failure, timeout, and
cancellation. Diff tests must cover each action, paths with spaces and Unicode,
malformed/unknown action markers, result overflow, missing containers, and
capture truncation. Assert no operation can inject a flag or a second command
argument through a resource value.

### 4. Fixture-contract migration and scenarios

Extend `FixtureScenario` atomically to five supported names:

- `missing-env`
- `unhealthy-container`
- `insufficient-evidence`
- `image-regression`
- `writable-layer-change`

Evolve the versioned fixture schema in one compatible migration. Each fixture
must include captured-format observations for image inventory, process tables,
image history, and filesystem diffs as applicable, in addition to the existing
lifecycle fields. Preserve fixtures' use of shared live projectors by adapting
the fixture observations into neutral `DockerCommandResult` values; do not
duplicate projection text or bypass error mapping. If the schema version is
incremented, migrate all three existing files in the same change and make the
loader reject mixed or unknown versions deterministically.

The `image-regression` walkthrough should follow image discovery → image
inspect → bounded image history, and only claim a changed image/tag or layer
observation that the fixture supports. The `writable-layer-change` walkthrough
should follow container discovery/inspect → bounded `docker_diff` → optional
`docker_top` or logs, distinguish observed paths from causality, and include a
case where evidence remains insufficient to attribute the change.

Fixture tests must assert public schema equality between fixture and live tools
for all nine registrations; every fixture must work without a Docker binary or
context. Add parity cases for successes, empty output, not-found errors, row
limits, and withheld raw history content. Update CLI fixture validation and
usage output in the same slice so no advertised scenario lacks a file.

### 5. Documentation and deterministic gate

Update the README, quickstart, security guidance, and upstream port map only
after the tools and fixtures exist. Document all nine available read-only tools
and explicitly preserve the exclusions: Docker writes, `docker exec`, custom
process options, registry access, and unbounded streams. Explain that process
values and diff paths are untrusted evidence; image-history raw build commands
are withheld; and normal Phase 2 evidence budgets still apply after per-tool
projection and row limits.

Add this document to the README's documentation list. Document fixture names,
the image-regression and writable-layer walkthroughs, Docker/Node prerequisites,
context pinning, and the distinction between deterministic tests, live-Docker
validation, and Phase 5 real-model evaluation.

Run `npm run check`, the complete test suite, and `git diff --check`. Keep the
authenticated provider test separately identified; it is neither deterministic
Docker coverage nor a Phase 4 live-Docker validation.

### 6. Disposable live-Docker validation

Only after the deterministic gate passes, extend `examples/docker` with
credential-free disposable data that produces a running process view, an
image-history target, and a harmless writable-layer change. The demonstration
must use fixed public images/configuration, no labels, mounts, environment
values, ports, credentials, or production data. It may reuse the existing
crashed/unhealthy services only if doing so does not make the example harder to
clean up or obscure the Phase 3 validation purpose.

Record Docker CLI/Engine/Compose versions, host OS, selected context, commands
exercised, and only projected outcomes/counts in
`docs/phase-4-live-docker-validation.md`. Demonstrate context resolution and
pinned-context execution for image discovery, image history, top on a running
container, and diff after the intentional harmless change. Include one safe
absent or stopped-resource check. Do not commit container IDs, raw `docker top`
rows, raw history commands, raw diff paths, logs, inspect output, or secrets.
Tear down the disposable environment when validation finishes.

## Phase 4 exit gate

- [x] Every new Docker operation is a closed, fixed read-only argument array
      under the one pinned context, with no shell, arbitrary option, or
      mutating operation.
- [x] `docker_images`, `docker_top`, `docker_history`, and `docker_diff`
      return projected, bounded, structured observations rather than
      `unavailable`.
- [x] Image, process, history, and diff projectors reject malformed output,
      do not forward raw Docker errors, preserve truncation provenance, and
      apply independent row limits before Phase 2 evidence retention.
- [x] Raw history commands and arbitrary raw Docker/configuration fields do
      not reach tool content or metadata; process output and diff paths are
      clearly treated as untrusted evidence.
- [x] Stopped/missing targets, daemon failures, cancellation, subprocess
      timeout, and capture truncation have safe, deterministic results.
- [x] All five fixture scenarios use the same schemas, validation, projections,
      limits, and error semantics as live mode without requiring Docker.
- [x] `npm run check`, the complete test suite, and `git diff --check` pass.
- [x] A disposable live-Docker run records image/runtime validation without
      widening the command surface or committing sensitive raw output.

The completed live-Docker validation is recorded in
[phase-4-live-docker-validation.md](phase-4-live-docker-validation.md).
Phase 5 may now proceed with real-model fixture evaluations, renderer
completion, and release-readiness work.
