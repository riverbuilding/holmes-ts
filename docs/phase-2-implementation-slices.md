# Phase 2 implementation slices — bounded, evidence-safe engine

Date: September 10, 2026  
Status: ready to implement  
Prerequisite: Phase 1 at `22f5e26`

This document decomposes Phase 2 from the
[current-state implementation plan](current-state-implementation-plan.md) into
small, test-first slices. It makes the investigation orchestrator bounded and
evidence-safe before any Docker or fixture executor exists.

Phase 2 is deliberately **Docker-free**. Tests use an in-memory
`ToolRegistry`, deterministic tools, an injectable clock, and scripted
providers. Do not invoke the Docker CLI, connect to a Docker daemon, or add a
Docker execution adapter in this phase.

## Phase boundary and non-goals

Phase 2 owns orchestration and the transformation of an already-returned tool
result into model-safe evidence. It does not change the nine public schemas or
make tools capable of collecting observations.

- Preserve each provider-issued `ToolCall.id` in the assistant history, the
  corresponding `ToolMessage`, error payload metadata where present, and the
  `Evidence.toolCallId`.
- Treat tool content and model text as untrusted input. Redact and bound the
  content before it is stored as evidence or passed back to the model.
- Keep the investigation-wide deadline authoritative. Model and tool calls
  receive derived abort signals; no late completion may append evidence or
  history.
- Use `maxConcurrentToolCalls` only for calls returned in the same provider
  response. Separate model turns remain sequential.
- Never spend the last allowed model call on another tool-selection turn when
  a final synthesis can still be requested.
- Keep renderer layout work and real-model quality evaluation in Phase 5. This
  phase adds the structured data and deterministic tests they need, not the
  final terminal presentation.

## Decisions to freeze in the first slice

These decisions remove ambiguity for the implementation slices that follow.

| Concern | Phase 2 decision |
|---|---|
| Evidence ID | Allocate `E1`, `E2`, ... only for retained successful observations, in original provider call order. A redacted/clipped success still receives an ID; a tool error does not. |
| Call identity | A `ToolMessage.toolCallId` always equals the `ToolCall.id` it answers. `ToolResultMetadata.toolCallId`, when emitted or normalized, has that same value. |
| Evidence budget | `maxCharsPerResult` bounds one successful result after redaction; `maxEvidenceChars` bounds the total retained evidence content. Count JavaScript string length consistently. Retain a deterministic prefix of the next item only when budget remains, annotate it as `evidence-budget`, and omit later successes from evidence. |
| Redaction | `evidence.ts` accepts an explicit set of known secret values and applies deterministic replacement before character counting or clipping. Empty/too-short values are not redacted. The initial wiring uses no inferred secrets; Phase 3 supplies projected Docker data and known values. |
| Duplicate key | Normalize a request as tool name plus a stable, recursively key-sorted JSON representation of arguments. It is scoped to the investigation and does not include provider call ID. After two completed, unchanged results for that key, return `duplicate` without dispatching again. |
| Unchanged result | Compare a canonical, redacted-and-bounded representation of the tool result: status, normalized content or error code/message, metadata, and truncation. This avoids treating changing secret values as a reason to retry. |
| Final synthesis | Invoke the provider with the accumulated message history and an empty tools array. The engine reserves one model-call slot while it is still able to accept tool calls. A response that nevertheless requests tools is not executed; return a partial `model-limit`/protocol-safe result instead. |
| Citations | Recognize bracketed evidence references such as `[E1]` and `[E1, E2]`. Validate against retained evidence IDs only. Preserve the model answer and expose invalid/missing citations structurally so a renderer can visibly warn rather than silently repair claims. |

The first implementation slice may extend `InvestigationResult` with a
read-only citation-validation field and a normalised partial-reason detail.
The exact shape should be small and public (for example, valid IDs, invalid
IDs, and whether any citation appeared); do not encode renderer strings in the
core contract.

## Slice sequence

| Slice | Deliverable | Primary files | Completion criteria |
|---|---|---|---|
| 1. Evidence contract and pure utilities | Add `src/core/evidence.ts`; extend core result contracts only as needed for citation validation and safe partial answers. Implement pure helpers for canonicalization, redaction, per-result clipping, evidence-budget accounting, deterministic IDs, and citation extraction/validation. | `src/core/evidence.ts`, `src/core/types.ts`, `src/tests/evidence.test.ts` | Unit tests prove helpers are deterministic, never mutate caller values, redact before counting, retain correct truncation metadata, and reject unknown citations. |
| 2. Deadline and cancellation boundary | Add injectable time/timer seams and derived abort signals for the global deadline, model timeout, and tool timeout. Use the smaller applicable timeout and distinguish caller cancellation from elapsed deadline. | `src/core/investigate.ts`, `src/tests/investigate.test.ts` | Tests prove the original caller signal reaches every child operation, model/tool timeouts abort their child only, deadline wins when earlier, and late completions cannot update state. |
| 3. Ordered concurrent tool batch | Replace sequential dispatch with a bounded worker pool for one assistant response. Create every result in provider-call order after all started work settles or is aborted. | `src/core/investigate.ts`, `src/tests/investigate.test.ts` | Controlled deferred tools demonstrate overlap up to the configured limit, deterministic history/evidence order despite reverse completion, and exact matching call IDs for successes, validation errors, unknown tools, and executor errors. |
| 4. Safe evidence ingestion and budgets | Route every successful dispatch through the evidence helper before appending an evidence item or tool message. Include redaction/truncation indicators in the tool-message content without exposing removed data. | `src/core/investigate.ts`, `src/core/evidence.ts`, `src/tests/investigate.test.ts` | Tests cover character clipping, total-budget exhaustion, prefix retention, zero remaining budget, ordered IDs with omitted later evidence, and no secret string in `InvestigationResult` or provider history. |
| 5. Duplicate suppression | Track canonical request/result pairs across model turns. After two unchanged completed outcomes, answer later identical calls with a structured non-retryable `duplicate` tool result and do not dispatch them. | `src/core/investigate.ts`, `src/core/evidence.ts`, `src/tests/investigate.test.ts` | Tests show object-key order does not evade suppression, changed results reset the unchanged count, errors can be tracked safely, and each suppressed call still receives its own matching `ToolMessage`. |
| 6. Reserved final synthesis and partial paths | Reserve one model call for an empty-tools final synthesis. On tool/model limit, duplicate-only terminal state, provider failure, deadline, or cancellation, attempt that synthesis only when a live reserved slot and time remain; otherwise return an evidence-backed partial result. | `src/core/investigate.ts`, `src/core/types.ts`, `src/tests/investigate.test.ts` | Tests prove the last normal slot is not used for tool selection, synthesis sees all retained ordered history with `[]` tools, tools requested during synthesis never run, and every stop reason has deterministic partial behavior. |
| 7. Citation validation integration | Validate the final or partial-synthesis answer against the evidence retained by the engine and place the structured validation result on `InvestigationResult`. Update the renderer only enough to surface an existing validation warning if the contract requires it; defer final design to Phase 5. | `src/core/investigate.ts`, `src/core/evidence.ts`, `src/core/types.ts`, `src/output/render.ts`, `src/tests/investigate.test.ts` | Valid citations, malformed tokens, duplicate citations, citations to omitted/budgeted-out observations, and mixed valid/invalid citations are deterministic and visible to callers. |
| 8. Regression suite and documentation | Split focused deterministic tests by behavior, document the engine guarantees, run formatting/type checks/tests, and retain Phase 1 provider coverage unchanged. | `src/tests/evidence.test.ts`, `src/tests/investigate.test.ts`, `README.md`, `docs/security-and-data-handling.md` as needed | `npm run check` and the entire deterministic suite pass without Docker, fixtures, network access beyond the pre-existing Phase 1 provider integration configuration. |

## Implementation detail by slice

### 1. Evidence contract and pure utilities

Keep `evidence.ts` side-effect free. Its public API should make it impossible
for the loop to accidentally append raw content after a helper returns a safe
value. A practical shape is an `EvidenceCollector` that owns the next ID and
remaining characters, plus pure exports for `canonicalize`, `redact`, and
`validateCitations`.

Redaction must be exact-value based, longest secrets first, with a stable
placeholder such as `[REDACTED]`. Do not attempt heuristic detection of
credentials in Phase 2: it is both unreliable and a substitute for the
Docker-data projection/redaction work planned in Phase 3. Preserve any
upstream tool-provided `Truncation` and combine it with engine-applied clipping
in an unambiguous way; if the current single truncation field cannot faithfully
represent both, evolve it before use rather than dropping provenance.

Tests should include overlapping secret values, empty values, a secret split by
the clipping boundary, Unicode code units, already-truncated results, and
metadata that must remain JSON-safe. No test fixture may contain a real token.

### 2. Deadline and cancellation boundary

Compute an absolute deadline once from `startedAt + deadlineMs`. Before every
provider call and dispatch, calculate remaining time. Construct a child
`AbortController` that aborts when either the caller aborts or the earliest
applicable timeout expires, and always remove listeners/timers on settlement.

- Provider timeout: minimum of `modelTimeoutMs` and remaining global time.
- Tool timeout: minimum of `subprocessTimeoutMs` and remaining global time.
- A caller-aborted signal yields `cancelled`; an elapsed global deadline yields
  `deadline`; a per-operation timeout is normalized to a safe tool/provider
  failure without leaking executor errors.

Do not rely on a tool/provider to ignore a late promise. The engine must gate
every post-`await` state change on the batch/operation still being live.

### 3. Ordered concurrent tool batch

Plan the entire response batch before starting workers. Enforce the remaining
tool-call budget in original call order: allowed calls run; calls beyond it get
matching, structured budget responses and trigger the stop path after the
batch's allowed calls settle. This prevents a race from exceeding
`maxToolCalls`.

Use an index-addressed result array and append to `messages` only after the
batch settles, traversing its original indexes. This gives a stable sequence
for evidence IDs, tool messages, duplicate accounting, and tests. A malformed
or unknown call is a completed result in that position; it must not prevent
independent valid calls from executing.

### 4. Safe evidence ingestion and budgets

For each successful tool result in deterministic order:

1. Normalize metadata and bind the actual provider call ID.
2. Redact content.
3. Apply the per-result character cap, then the remaining total evidence cap.
4. Add an evidence item only if content is retained under the frozen policy.
5. Send the provider a `ToolMessage` for every call. Its content must identify
   the retained evidence ID when there is one and state that an observation was
   clipped/omitted when applicable.

A model must never be told that an omitted observation has a citeable ID. The
evidence array is the sole citation authority.

### 5. Duplicate suppression

Store the previous canonical completed result and consecutive unchanged count
for each canonical request. The first and second actual executions are allowed;
the third unchanged request is suppressed. A different result resets the
counter. Decide and test explicitly whether cancellation/deadline outcomes are
recorded; the recommended policy is not to count operations that did not
settle, because they did not establish repetition.

The synthetic duplicate response should have `status: "error"`, code
`"duplicate"`, `retryable: false`, safe text, the target call ID in metadata,
and no evidence item. It is sent to the model in normal call-order position.

### 6. Reserved final synthesis and partial paths

Separate two states: normal tool-selection turns (tools supplied) and final
synthesis (empty tools). Once a normal turn returns calls but only one model
call remains, execute the permitted batch and immediately synthesize; do not
ask for another selection turn.

Use the normal final-answer response directly only when it arrives from a
normal turn with no calls. Otherwise, when a stop condition occurs, make at
most one reserved final-synthesis request if the signal is live and remaining
time can start it. If that request fails, return the deterministic partial
answer and original stop reason. Never replace a more specific reason with a
synthesis failure.

The deterministic fallback remains deliberately factual: incomplete status,
the exact stop reason, retained evidence count/IDs, and no inferred root cause.

### 7. Citation validation integration

Citation parsing is validation, not claim verification. It proves only that a
referenced ID exists; it cannot establish that a conclusion follows from the
evidence. The prompt's observed-fact versus hypothesis instructions remain the
other guardrail.

Store the validation result for every answer path, including a zero-evidence
answer. Invalid references must name only the invalid evidence identifier, not
reprint surrounding model text. If the renderer is changed in this slice, its
only responsibility is to label unverified citation references; Phase 5 owns
the full observed-evidence/conclusion layout.

## Deterministic test matrix

| Behavior | Required deterministic assertion |
|---|---|
| Call IDs/history | Assistant structured calls and every subsequent tool result preserve the exact provider ID; out-of-order completion never changes history order. |
| Concurrency | Two independent deferred calls start before either completes; active calls never exceed the configured cap. |
| Deadline/cancellation | Caller abort, global deadline, model timeout, tool timeout, and a late resolving tool each produce the expected result and no post-stop mutation. |
| Limits | Model, tool, per-result, total-evidence, and concurrency limits are never exceeded; the final model slot is reserved. |
| Evidence safety | Known secrets are absent from evidence and forwarded history; redaction precedes clipping/counting; all truncation reasons and retained counts are correct. |
| Errors | Unknown tool, invalid arguments, executor error, timeout, duplicate, and provider error retain their matching call IDs and cannot become evidence. |
| Duplicates | Canonical argument ordering is stable; exactly two unchanged actual results may execute; changed values reset the tracker. |
| Synthesis | Final synthesis receives `[]` tools, cannot cause a tool dispatch, includes ordered retained evidence, and falls back cleanly on its own failure. |
| Citations | `E1` and multi-ID references validate; unknown, malformed, repeated, and budget-omitted IDs are reported accurately. |

Use controlled promises/fake timers or an injected scheduler rather than wall
clock sleeps. Tests must not need `LLM_API_KEY`, Docker, a Docker socket, or
network access. The existing authenticated provider integration remains a
Phase 1 test and should not be broadened to exercise the engine here.

## Recommended pull-request order

1. Slice 1: core evidence primitives and contract changes with isolated tests.
2. Slice 2: abort/deadline plumbing before introducing concurrency.
3. Slice 3: ordered concurrent batches and tool-budget reservation.
4. Slice 4: route successes through the evidence collector and enforce bounds.
5. Slice 5: duplicate tracking and synthetic results.
6. Slice 6: reserved final synthesis and all partial-result paths.
7. Slice 7: citation validation and minimal output exposure.
8. Slice 8: regression/documentation cleanup and full verification.

Each pull request should include only the tests for its slice plus any narrow
regression tests revealed by its changes. Do not begin Phase 3 until all eight
slices pass the gate below.

## Phase 2 exit gate

- [ ] `src/core/evidence.ts` is the only path that turns a successful tool
      result into retained evidence/model-visible content.
- [ ] Evidence IDs, provider call IDs, tool history, output ordering, clipping,
      redaction, and citation validation are deterministic.
- [ ] Every provider/tool operation receives a derived deadline-aware abort
      signal and cannot mutate the completed investigation after expiry.
- [ ] Independent tool calls run concurrently within the configured cap and
      append in provider order.
- [ ] Repeated unchanged requests are suppressed after two completed results.
- [ ] A final empty-tools synthesis is reserved when possible; otherwise the
      returned result is explicitly partial and evidence-backed.
- [ ] `npm run check` and all deterministic engine tests pass without any
      Docker command, Docker daemon, fixture backend, or real model call.

Only after this gate is met may Phase 3 add the fixed-array Docker execution
adapter and begin Docker-specific tests.
