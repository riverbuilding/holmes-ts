# holmes-ts

A TypeScript port of HolmesGPT's complete local-Docker diagnostic toolset, based on the scope in [docs/holmesgpt-typescript-mvp-plan.md](docs/holmesgpt-typescript-mvp-plan.md).

## Project status

The bounded, evidence-safe investigation engine and Phase 5 fixture evaluator
are available alongside the OpenAI-compatible Chat Completions provider. It
can investigate through fixtures or one pinned local Docker context using all
nine read-only Docker tools: `docker_images`, `docker_ps`, `docker_ps_all`,
`docker_inspect`, `docker_logs`, `docker_top`, `docker_events`,
`docker_history`, and `docker_diff`. Phase 5 is not release-ready yet: the
current [fixture evaluation record](docs/evaluations/README.md) retains failed
provider attempts and needs reviewed passing runs.

## Investigation engine guarantees

- Successful tool output becomes evidence only through the bounded evidence
  collector. Known secret values are redacted before character counting;
  per-result and investigation-wide budgets retain deterministic prefixes and
  record truncation provenance.
- Retained observations receive stable `E1`, `E2`, … IDs in provider call
  order. Tool-call IDs are preserved in assistant history, tool messages, and
  evidence. Answers expose citation validation against retained evidence only.
- Every model and tool operation receives a derived abort signal. Caller
  cancellation, the investigation deadline, and per-operation timeouts cannot
  permit late evidence or history updates.
- Calls from one model response may run concurrently only up to the configured
  cap; their results are committed in provider order. Repeated unchanged
  requests are suppressed after two completed executions.
- One model-call slot is reserved for an empty-tools final synthesis. When no
  safe synthesis is possible, the engine returns an explicit, factual partial
  result with its stop reason and retained evidence IDs.

## Development

```bash
npm ci
npm run check
npm test
```

Run a deterministic fixture investigation without a Docker daemon:

```bash
npm run dev -- ask "Why did checkout exit?" --fixture missing-env
```

`npm test` is the deterministic gate: it uses scripted providers, in-memory
registries, fake processes/timers, and fixed observations. It needs no
credentials, network, Python, Docker CLI, or Docker daemon.

The external commands are intentionally separate: `npm run test:provider`
performs the real provider protocol check and requires credentials plus
network access; `npm run evaluate:fixtures -- --runs 1 --report <path>` sends
fixed fixture observations to that provider and can incur provider usage. Both
need `LLM_API_KEY`; use a tool-calling-capable `LLM_MODEL` and compatible
`LLM_BASE_URL`. Neither command invokes Docker.

## Current layout

- `src/cli.ts` and `src/config.ts`: command parsing and environment validation.
- `src/core/`: bounded investigation-loop contracts and implementation.
- `src/llm/`: provider interface and OpenAI-compatible Chat Completions adapter.
- `src/tools/`: registry, fixed-array Docker CLI adapter, lifecycle-tool
  projections, and fixture factories.
- `src/prompts/`: attributed local-Docker investigation prompt.
- `src/output/`: terminal-result rendering.
- `src/tests/evidence.test.ts`: deterministic evidence, redaction, budget,
  and citation tests.
- `src/tests/investigate.test.ts`: deterministic engine limits, cancellation,
  concurrency, ordering, duplicate, and synthesis tests.
- `src/tests/`: also retains Phase 1 contract/schema/registry/provider tests.
- `fixtures/`: fixed observations for `missing-env`, `unhealthy-container`,
  `insufficient-evidence`, `image-regression`, and `writable-layer-change`.
- `examples/docker/`: disposable crashed/unhealthy/writable Compose
  demonstration for lifecycle and image/runtime validation.
- `examples/kubernetes/`: legacy empty placeholder; Kubernetes is out of scope.

## Documentation

- [Scope and implementation plan](docs/holmesgpt-typescript-mvp-plan.md)
- [Current-state implementation plan](docs/current-state-implementation-plan.md)
- [Phase 2 evidence-safe engine implementation slices](docs/phase-2-implementation-slices.md)
- [Phase 3 safe Docker lifecycle implementation slices](docs/phase-3-implementation-slices.md)
- [Phase 3 live-Docker validation record](docs/phase-3-live-docker-validation.md)
- [Phase 4 image and runtime implementation slices](docs/phase-4-implementation-slices.md)
- [Phase 4 live-Docker validation record](docs/phase-4-live-docker-validation.md)
- [Phase 5 answer-quality and release-readiness implementation slices](docs/phase-5-implementation-slices.md)
- [Fixture evaluation workflow and reports](docs/evaluations/README.md)
- [Quickstart and current availability](docs/quickstart.md)
- [Upstream Docker port map](docs/upstream-port-map.md)
- [Security and data handling](docs/security-and-data-handling.md)
- [Investigation-target history](docs/investigation-target-candidates.md)
