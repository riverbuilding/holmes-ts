# Phase 5 implementation slices — answer quality and release readiness

Date: September 16, 2026
Status: ready to implement
Prerequisite met: Phase 4 exit gate, including the recorded disposable
live-Docker validation at `b2b4998`

This document decomposes Phase 5 of the
[current-state implementation plan](current-state-implementation-plan.md) into
small, test-first slices. Phase 5 does not expand the nine-tool Docker surface.
It makes the final answer legible and honest, measures the configured model
against all five deterministic fixture scenarios, addresses evaluation findings,
and makes the shipped workflow reproducible from a clean checkout.

## Phase boundary and non-goals

The existing engine remains the authority for investigation completion,
stop reason, evidence retention, redaction, truncation, and citation
validation. The renderer must display those facts; it must not decide whether a
claim is true, invent a remediation, repair a citation, reveal raw evidence,
or turn a partial result into a complete one.

Fixture evaluations use the real configured provider but only fixture tools.
They must not resolve a Docker context, launch Docker, access a Docker socket,
or use production evidence. They are a release-quality sample, not a claim of
general diagnostic correctness. The Phase 3/4 disposable live-Docker records
remain separate operational checks.

This phase does not add tools, Docker commands, mutable operations, automatic
remediation, provider retries, model fallbacks, persistent conversation state,
arbitrary prompt configuration, or a new telemetry service. It also must not
publish API keys, provider request bodies, raw model transcripts, raw fixture
observations, or unreviewed model claims in versioned reports.

## Decisions frozen before implementation

| Concern | Phase 5 decision |
| --- | --- |
| Final-answer contract | The prompt requires four exact, human-facing sections: `Finding`, `Evidence`, `Next steps`, and `Uncertainty`. Factual statements in `Finding` and `Evidence` must cite retained `E...` IDs. `Next steps` remain non-executed suggestions. |
| Renderer ownership | `renderResult` consumes only `InvestigationResult`; it does not call a provider, registry, Docker, filesystem, or clock. It renders fixed status, citation, and retained-evidence data alongside the model text. |
| Section parsing/fallback | Use one small pure parser for the four canonical headings. Preserve section text verbatim. If a section is missing or malformed, render that labeled section as `Not supplied by the model.` and preserve all unparsed answer text under `Finding`; do not fabricate content or silently discard it. |
| Complete versus partial | Render `Status: complete` only when `result.complete` is true. Otherwise render `Status: partial` and a fixed safe explanation derived from the existing `reason`; never expose a raw provider or Docker error. Citation warnings do not alter this engine-owned status. |
| Evidence display | Render retained evidence as ID, tool name, safe resource metadata, and truncation provenance. Do not print evidence content, raw Docker output, stderr, or omitted metadata. The model's `Evidence` section remains clearly model-authored, while the retained-evidence list is application-authored. |
| Citation display | Display valid cited IDs separately from invalid, duplicate, malformed, and absent-when-evidence-exists citations. An invalid reference remains visible as a warning; it is never removed, changed to a valid ID, or used to support a claim. |
| Prompt testing | Keep exact snapshots deliberately narrow and readable: an attribution/header snapshot plus the normalized prompt body. Pair them with semantic assertions for safety-critical requirements so a wording-only update has an intentional review point. |
| External test boundary | Deterministic checks must run without credentials, network, Docker, or a daemon. Keep the existing real-provider protocol round trip as an explicit external command, and add a distinct fixture-evaluation command. Neither belongs in the deterministic gate. |
| Evaluation data | The committed report contains reproducible run summaries and human review decisions, not credentials or raw transcripts. If the provider exposes token usage, record normalized aggregate/request usage; otherwise record `unavailable`, never an invented value. |
| Evaluation acceptance | A run passes only if it follows the scenario's required evidence path sufficiently, has no invalid/malformed/duplicate citations, cites relevant retained evidence, meets the scenario conclusion criterion, and has no material unsupported claim after review. A scenario passes only when all five required runs pass, unless a documented fix and full affected-scenario rerun replaces them. |

## Output contract

The renderer's stable terminal layout is intentionally small and text-only:

```text
Status: complete

Finding
<model-supplied finding>

Evidence
<model-supplied evidence explanation>

Retained evidence
- E1 — docker_logs — container/checkout-api
- E2 — docker_inspect — container/checkout-api (truncated: row-limit)

Next steps
<model-supplied next steps>

Uncertainty
<model-supplied uncertainty>

Citation warnings
- Unknown evidence ID: E9
- No evidence citations were supplied despite retained evidence.
```

For a partial result, the first line is `Status: partial — <safe reason>`.
`<safe reason>` is a fixed mapping of the closed `InvestigationStopReason`
union, such as `investigation deadline reached` or `model provider failed`.
The model response is not transformed to conceal or strengthen a claim. If it
does not conform to the required section format, every required heading still
appears and the fallback makes the omission explicit.

`Citation warnings` appears only when applicable. It must cover, in stable
order, unknown IDs, duplicate IDs, malformed evidence-shaped tokens, and the
absence of any citation when retained evidence exists. A valid citation is not
proof that the associated claim is supported; that distinction belongs in the
prompt, evaluation rubric, and user-facing uncertainty.

## Completion record

| Slice | Delivered work | Primary files | Deterministic exit evidence |
| --- | --- | --- | --- |
| 1. Renderer contract | Define the section/fallback behavior and implement the complete/partial renderer. | `src/output/render.ts`, `src/tests/render.test.ts` | Exact output snapshots cover complete, every partial reason, zero evidence, truncation, and every citation warning category. |
| 2. Prompt quality contract | Tighten the adapted prompt to require the renderable answer shape and preserve local-Docker safety semantics. | `src/prompts/local-docker-investigate.ts`, `src/tests/local-docker-investigate-prompt.test.ts` | Snapshot and semantic tests pin attribution, section contract, citation/fact-inference rules, logs/state/events behavior, and scope exclusions. |
| 3. Reproducible real-model evaluator | Add an explicit evaluation runner, normalized optional provider usage, scenario rubrics, and report template. | `src/evaluation/*`, `src/llm/*`, `src/core/types.ts`, `src/tests/evaluation*.test.ts`, `package.json`, `docs/evaluations/*` | Runner tests use a scripted provider and fixture tools only; they prove fixed inputs, safe summary generation, metric accounting, and no Docker startup. |
| 4. Five-by-five model evaluation | Run every fixture scenario at least five times with the configured real model; review and record results. | `docs/evaluations/phase-5-fixture-evaluation-YYYY-MM-DD.md` | Versioned report has 25 or more reviewed runs, model/prompt/fixture identity, metrics, evidence/citation outcome, and scenario verdicts. |
| 5. Corrective loop | Fix only concrete material defects found in Slice 4, then rerun every affected scenario five times and supersede its affected rows. | Narrowly determined by finding; report update | Focused regression tests plus rerun results demonstrate the fix without widening Docker authority. |
| 6. Release documentation and clean checkout | Align user docs, sample configuration, command boundaries, and a clean-checkout verification sequence. | `README.md`, `docs/quickstart.md`, `docs/security-and-data-handling.md`, `.env.example`, `package.json`, release/verification tests | A fresh clone passes the documented deterministic gate and the documented fixture workflow with explicit provider credentials; no Python or Docker is needed for fixtures. |

## Implementation detail by slice

### 1. Renderer contract and terminal snapshots

Create `src/tests/render.test.ts` before changing the implementation. Build
minimal `InvestigationResult` factories that cover the renderer without
re-exercising the engine. Test an exact, newline-stable string for:

- a complete result with canonical model sections, two evidence items, one
  truncated item, and valid citations;
- each partial stop reason (`deadline`, `tool-limit`, `model-limit`,
  `duplicate-only`, `cancelled`, and `provider-error`), proving the fixed safe
  reason rather than an internal error is displayed;
- no retained evidence and no citations;
- unknown IDs, duplicates, malformed citation-shaped tokens, and no citations
  despite retained evidence, both separately and in their documented order;
- a model answer with missing, duplicated, reordered, or unrecognized
  headings, proving all text is retained and no section is invented; and
- evidence entries with source and engine truncations, proving the user can
  see bounded/partial provenance without seeing raw evidence content.

Implement a pure canonical-heading parser in `src/output/render.ts`. It
accepts only the model's answer string and returns display sections; it must
not inspect evidence text to infer a finding. Keep the existing structured
`citationValidation` as the sole source of citation warnings. Add a fixed,
exhaustive mapping for every current `InvestigationStopReason`; TypeScript
should force an update if the union changes.

Keep the renderer's public input as `InvestigationResult`. Do not add a second
model-answer schema or mutable renderer state: the current result already has
the completion, citation, and evidence contracts this display needs. If an
implementation reveals a concrete need for a new field, add it only with its
current renderer/evaluator consumer and deterministic tests.

### 2. Prompt semantic and snapshot coverage

Update `LOCAL_DOCKER_INVESTIGATION_SYSTEM_PROMPT` to specify the exact four
final-answer headings, concise plain-text form, cited factual statements, and
the renderer's inability to repair an invalid citation. Preserve the existing
Apache-2.0 attribution and existing read-only scope sentence rather than
rewriting unrelated prompt wording.

Expand `src/tests/local-docker-investigate-prompt.test.ts` with two kinds of
coverage:

- an exact normalized snapshot of the attributed prompt (normalizing only
  line endings), so substantive wording changes are reviewable; and
- focused assertions for: evidence before conclusion; logs for reported
  application/container failures; state and events for lifecycle failures;
  facts versus hypotheses; valid evidence-ID citations; uncertainty; safe,
  non-executed next steps; untrusted tool data; one local context; all nine
  read-only capability classes; and exclusions including Docker writes,
  `docker exec`, remote systems, plugins, and skills.

Add a small renderer/prompt integration test with a scripted investigation:
the final response follows the canonical layout, has both valid and invalid
citation cases, and rendering surfaces the engine's validation rather than
attempting to change the answer. This remains deterministic and does not
contact the configured provider.

### 3. Reproducible real-model evaluator

Add a dedicated evaluator rather than hiding real model calls inside ordinary
unit tests. It should create the existing fixture registry, call `investigate`
with the production system prompt and default limits, and never create a
`DockerCli`. Keep scenario inputs and rubrics in typed source data so the
runner, tests, and report use the same five definitions.

Use these fixed evaluator questions and acceptance criteria:

| Fixture scenario | Evaluation question | Required evidence behavior | Required conclusion |
| --- | --- | --- | --- |
| `missing-env` | “Why did checkout exit? State the supported cause, safe next steps, and uncertainty.” | Find the exited target, inspect it, and read its logs; events may corroborate. | Identify the missing configuration only where state/log evidence supports it. |
| `unhealthy-container` | “Why is checkout-api unhealthy? Separate the health symptom from the supported cause.” | Discover the running target, inspect health, inspect events, and read logs. | State the observed health state and only the dependency failure evidence actually available. |
| `insufficient-evidence` | “Can the root cause of checkout-api be established? State what is known and what is missing.” | Discover/inspect and attempt the relevant events/logs path, including the absent or empty observation. | Do not manufacture a root cause; state the missing evidence and next safe observation. |
| `image-regression` | “What evidence is available for a checkout image regression, and what should be checked next?” | Discover image, inspect the relevant image, and read bounded history. | Identify the image/layer observation without claiming a regression cause that the fixture cannot prove. |
| `writable-layer-change` | “What changed in checkout-api’s writable layer, and what can or cannot be concluded?” | Discover/inspect target and use `docker_diff`; use `docker_top` or logs only when relevant. | Distinguish observed paths from a causal explanation and state a safe next check. |

The runner should take an explicit positive run count (default `5`) and an
explicit output destination. A package command such as
`npm run evaluate:fixtures -- --runs 5 --report <path>` is appropriate. It
must fail before network use when `LLM_API_KEY` is absent, the count is invalid,
or the destination is outside the approved evaluation-report directory. It
must print no API key and must not log full prompts, tool content, provider
requests, or model answers.

Extend the provider response contract only as necessary to retain normalized
optional input/output/total token counts supplied by the compatible provider.
The OpenAI-compatible adapter validates those fields at its response boundary;
missing or malformed usage is `unavailable`, not an error and not zero. Add
adapter tests for valid, absent, and malformed usage. The evaluator aggregates
available usage across calls and records which counts are unavailable.

For each run, collect only a safe summary: UTC start/end or elapsed duration,
model identifier, scenario and fixture version/hash, prompt hash, tool names
and counts, complete/partial status and reason, retained evidence IDs and tool
names, citation-validation arrays, optional usage, automatic gate outcome, and
a reviewer decision. Do not store the model's prose answer or raw evidence in
the committed report. A reviewer compares the locally displayed answer with
the scenario rubric and records `pass`, `fail`, or `needs-review` plus a short
sanitized rationale and the count/category of material unsupported claims.

Add deterministic runner tests using a scripted provider. They must prove:

- each scenario builds the fixture registry and never asks the Docker adapter
  for context or launches a subprocess;
- run count, fixed question, rubric identity, prompt hash, fixture hash, tool
  sequence, elapsed-time measurement, and optional usage aggregation are
  deterministic under injected clock/provider dependencies;
- invalid citations, incomplete results, missing required evidence categories,
  and unsupported-claim reviewer failures cannot be reported as passing;
- report serializers reject secret-like configured values and avoid answer or
  evidence body fields; and
- a provider/model failure produces a completed safe summary for review but a
  failing scenario gate, without aborting unrelated scenarios.

### 4. Execute and record the five-by-five evaluation

Only after Slices 1–3 and the deterministic gate pass, run each scenario five
times against the configured real model. Use a stable explicit model ID and
base URL during one report cycle. Record the exact command, Node version,
package commit, report schema version, prompt SHA-256, fixture file SHA-256,
provider/model identifier, date/timezone, requested run count, and any
non-secret model settings that materially affect reproducibility.

Create a dated, versioned report at
`docs/evaluations/phase-5-fixture-evaluation-YYYY-MM-DD.md`. It must contain:

1. scope and privacy statement distinguishing fixture evaluation from
   deterministic and live-Docker validation;
2. configuration identity and hashes, with secrets omitted;
3. the five scenario questions, rubrics, and required tool/evidence categories;
4. a per-run table with run index, latency, available token usage, tool/evidence
   summary, citation outcome, automatic gate, reviewer verdict, conclusion
   outcome, and unsupported-claim category/count;
5. per-scenario totals (`5/5` or an explicit failure), plus an overall release
   recommendation; and
6. links to any corrective commit and replacement rerun table.

The report's review labels have precise meanings:

- `pass`: required conclusion is supported by relevant retained evidence, all
  citations are valid/nonduplicate/well formed, and no material unsupported
  claim is present;
- `fail`: a required path/conclusion/citation requirement is not met, or a
  material unsupported claim appears; and
- `needs-review`: transport/provider interruption, insufficient retained data
  to review, or an ambiguous conclusion that must not be counted as a pass.

A provider result should not be retried invisibly. Each attempted run is
recorded. A deliberate replacement run after a defect fix is linked to its
superseded run and uses the same scenario rubric unless the current task
explicitly changes that rubric.

### 5. Evaluation-driven corrective loop

Triage failed/needs-review results before changing code. Classify each finding
as one of: prompt adherence, renderer presentation, schema/argument rejection,
fixture/projection insufficiency, engine evidence/citation behavior,
provider protocol issue, or model variability. Preserve the original report
rows and record the classification and decision.

Make the smallest change that addresses a material, reproducible category:

- prompt failures change only the attributed prompt and its semantic/snapshot
  tests;
- renderer failures change only display parsing/layout and renderer tests;
- evidence/citation bugs change the responsible core path with focused
  deterministic regression coverage;
- fixture/projection failures must prove the fixture remains on the same shared
  public schema/projector path as live tools; and
- a provider-specific variability finding may be recorded as an environment
  limitation rather than solved by expanding permissions or weakening the
  rubric.

After a change, rerun all five repetitions for every affected scenario—not
only the one failed run—and append a dated replacement table/report revision.
If a shared prompt, renderer, engine, provider, registry, or fixture loader
changes, treat all five scenarios as affected. Do not declare the phase ready
while any scenario lacks five passing current-version runs.

### 6. Release documentation and clean-checkout verification

Update documentation only after the behavior and evaluation command exist:

- `README.md`: mark Phase 5 status accurately; link this slice plan and the
  dated evaluation report; distinguish deterministic tests, opt-in real
  provider protocol test, fixture evaluation, and disposable live-Docker
  validation.
- `docs/quickstart.md`: give copyable, credential-safe install/configure/check
  commands; list the fixture-evaluation command and cost/network boundary;
  explain complete versus partial output, section headings, citation warnings,
  exit behavior, and that fixture runs do not need Docker.
- `docs/security-and-data-handling.md`: document that fixture evaluation sends
  fixed fixture observations to the configured provider, reports retain only
  safe summaries, and live evidence still has the existing redaction limits and
  residual sensitivity risk. State that citation validity is not claim truth.
- `.env.example`: retain blank values only; document `LLM_API_KEY`, model/base
  URL, model timeout, Docker timeout, and any evaluator-only non-secret setting
  actually introduced. Do not add a value merely for a possible future mode.
- `package.json`: expose clearly named commands for deterministic checks,
  opt-in provider protocol verification, and fixture evaluation. The default
  developer/test command must not accidentally bill a provider or require
  Docker; external commands must state their credential/network requirement.

Document and run a clean-checkout sequence in a newly cloned worktree:

```bash
npm ci
npm run check
npm test
LLM_API_KEY=... LLM_MODEL=... LLM_BASE_URL=... npm run test:provider
LLM_API_KEY=... LLM_MODEL=... LLM_BASE_URL=... \
  npm run evaluate:fixtures -- --runs 5 --report docs/evaluations/phase-5-fixture-evaluation-YYYY-MM-DD.md
npm run dev -- ask "Why did checkout exit?" --fixture missing-env
git diff --check
```

Use a fresh temporary clone/worktree and a credential supplied through the
environment or ignored `.env`; do not put a key in shell history, report,
fixture, or committed configuration. The documented fixture walkthrough must
not require Docker. If the real-provider test/evaluation cannot run because
credentials or network authorization are absent, report that external gate as
not run rather than weakening it or fabricating a report.

## Phase 5 exit gate

- [ ] Terminal output labels complete and every partial reason, finding,
      model-authored evidence explanation, retained evidence, next steps,
      uncertainty, truncation provenance, and citation warnings without
      revealing raw evidence or repairing claims.
- [ ] Renderer snapshots and prompt snapshot/semantic tests cover canonical
      output, malformed/missing sections, invalid citations, the local-Docker
      evidence rules, and all read-only exclusions.
- [ ] The default deterministic suite runs without credentials, network,
      Docker CLI, daemon, or provider billing; the provider protocol and
      fixture-evaluation commands are explicit external gates.
- [ ] A real configured model has completed at least five reviewed runs for
      each of the five fixture scenarios, with a versioned report containing
      reproducibility data, latency, available token usage, citation/evidence
      outcomes, conclusion outcomes, and unsupported-claim review.
- [ ] Every current-version scenario has five passing runs, or the phase is
      explicitly not ready with failed/needs-review results retained in the
      report. No invalid citation or material unsupported claim is accepted.
- [ ] Any evaluation-derived correction has focused deterministic coverage and
      a full affected-scenario rerun record.
- [ ] README, quickstart, security guidance, `.env.example`, and command help
      accurately state capabilities, limits, data flow, external-cost boundary,
      fixtures, Docker prerequisite boundary, and exit behavior.
- [ ] The documented clean-checkout sequence, `npm run check`, `npm test`, and
      `git diff --check` pass. The Phase 3/4 live-Docker records remain
      distinct from real-model evaluation evidence.
