# Phase 5 fixture evaluation — September 17, 2026

Report schema: 1
Package commit: `fb7dce9`
Node: `v26.0.0`
Timezone: America/Toronto (EDT, UTC-04:00)
Requested runs: 5 per scenario (25 total)

## Scope and privacy

This is a fixture-only real-provider evaluation. It used the committed fixture
tool registry and did not resolve a Docker context, start Docker, access a
Docker socket, or use production evidence. It is separate from deterministic
tests and the Phase 3/4 disposable live-Docker validations.

The committed [machine-readable summary](phase-5-fixture-evaluation-2026-09-17.json)
contains no API key, prompt body, provider request, model prose, or evidence
body. There were no model answers to retain or review in this cycle.

## Reproducibility identity

Command:

```sh
set -a; source .env; set +a
npm run evaluate:fixtures -- --runs 5 --report docs/evaluations/phase-5-fixture-evaluation-2026-09-17.json
```

| Setting                               | Value                                                              |
| ------------------------------------- | ------------------------------------------------------------------ |
| Provider base URL                     | `https://openrouter.ai/api/v1`                                     |
| Model                                 | `openrouter/free`                                                  |
| Model timeout                         | 30000 ms                                                           |
| Prompt SHA-256                        | `d7d93aad30f760112226ea200d086ee094fd376b05b815b414e09f7dc5288499` |
| Fixture version                       | 2                                                                  |
| Missing-env fixture SHA-256           | `caa4b40dc8a6d0be14a4ed577b4c5e002a1de93c77140c9493477726fc974bc5` |
| Unhealthy-container fixture SHA-256   | `04b089da1e33c63c1d2688fdaf7a94f212c15bf0102726e6e970790b86a9f61b` |
| Insufficient-evidence fixture SHA-256 | `308356de51076469dd670e020ff0eef1505ccff08f2e43e47301628597d66de0` |
| Image-regression fixture SHA-256      | `edce751249b627ab14d7e92853de6851dd8c41d82d61d78c6b22cc7703d9a082` |
| Writable-layer-change fixture SHA-256 | `6a47e54b6ded665f809136e65035abe8c4f324394146fa32f1b4ce9fc4199c86` |

An independent single-request connectivity check performed after the recorded
attempts returned HTTP 429 from the configured provider. The evaluator maps
that failure safely to `provider-error`; it does not include provider response
bodies in the report.

## Scenarios and rubric

| Scenario                | Question                                                                                     | Required evidence path                                        | Conclusion criterion                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `missing-env`           | Why did checkout exit? State the supported cause, safe next steps, and uncertainty.          | `docker_ps_all`, `docker_inspect`, `docker_logs`              | Identify missing configuration only where state and logs support it.                 |
| `unhealthy-container`   | Why is checkout-api unhealthy? Separate the health symptom from the supported cause.         | `docker_ps`, `docker_inspect`, `docker_events`, `docker_logs` | State health and only available dependency-failure evidence.                         |
| `insufficient-evidence` | Can the root cause of checkout-api be established? State what is known and what is missing.  | `docker_ps`, `docker_inspect`, `docker_events`, `docker_logs` | Do not manufacture a root cause; state missing evidence and a safe next observation. |
| `image-regression`      | What evidence is available for a checkout image regression, and what should be checked next? | `docker_images`, `docker_inspect`, `docker_history`           | Identify image and layer observations without claiming an unproven regression cause. |
| `writable-layer-change` | What changed in checkout-api’s writable layer, and what can or cannot be concluded?          | `docker_ps`, `docker_inspect`, `docker_diff`                  | Distinguish observed paths from causal explanation and state a safe next check.      |

## Reviewed attempts

Every attempt ended before the first model response. Therefore: tool and
retained-evidence summaries are empty; token usage is unavailable; there are
no citations (and thus no invalid, duplicate, or malformed citations); the
conclusion outcome is not assessed; and material unsupported claims are zero.
`needs-review` is used exactly for the provider interruption and is not a pass.

| Scenario              | Run | Start (UTC)  | Latency | Tools / evidence | Citations | Usage       | Status / automatic gate        | Reviewer verdict                    | Conclusion / unsupported claims |
| --------------------- | --: | ------------ | ------: | ---------------- | --------- | ----------- | ------------------------------ | ----------------------------------- | ------------------------------- |
| missing-env           |   1 | 18:35:03.412 |   36 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| missing-env           |   2 | 18:35:03.448 |    2 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| missing-env           |   3 | 18:35:03.450 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| missing-env           |   4 | 18:35:03.451 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| missing-env           |   5 | 18:35:03.452 |    2 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| unhealthy-container   |   1 | 18:35:03.454 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| unhealthy-container   |   2 | 18:35:03.455 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| unhealthy-container   |   3 | 18:35:03.456 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| unhealthy-container   |   4 | 18:35:03.457 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| unhealthy-container   |   5 | 18:35:03.458 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| insufficient-evidence |   1 | 18:35:03.459 |    0 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| insufficient-evidence |   2 | 18:35:03.460 |    0 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| insufficient-evidence |   3 | 18:35:03.460 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| insufficient-evidence |   4 | 18:35:03.461 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| insufficient-evidence |   5 | 18:35:03.462 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| image-regression      |   1 | 18:35:03.463 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| image-regression      |   2 | 18:35:03.464 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| image-regression      |   3 | 18:35:03.465 |    0 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| image-regression      |   4 | 18:35:03.465 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| image-regression      |   5 | 18:35:03.466 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| writable-layer-change |   1 | 18:35:03.467 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| writable-layer-change |   2 | 18:35:03.468 |    0 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| writable-layer-change |   3 | 18:35:03.468 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| writable-layer-change |   4 | 18:35:03.469 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |
| writable-layer-change |   5 | 18:35:03.470 |    1 ms | none / none      | none      | unavailable | partial: provider-error / fail | needs-review: provider interruption | not assessed / 0                |

## Scenario totals and release recommendation

| Scenario              | Passes | Fails | Needs review | Verdict                                            |
| --------------------- | -----: | ----: | -----------: | -------------------------------------------------- |
| missing-env           |    0/5 |   0/5 |          5/5 | not evaluated: provider unavailable                |
| unhealthy-container   |    0/5 |   0/5 |          5/5 | not evaluated: provider unavailable                |
| insufficient-evidence |    0/5 |   0/5 |          5/5 | not evaluated: provider unavailable                |
| image-regression      |    0/5 |   0/5 |          5/5 | not evaluated: provider unavailable                |
| writable-layer-change |    0/5 |   0/5 |          5/5 | not evaluated: provider unavailable                |
| Overall               |   0/25 |  0/25 |        25/25 | **No-go for Phase 5 answer-quality release gate.** |

No corrective code change is indicated: no answer-quality behavior was
observed. Once a stable configured model route is available, rerun all five
scenarios five times with the same rubric and replace this table; do not count
these interrupted attempts as passes.
