# holmes-ts

A TypeScript port of HolmesGPT's complete local-Docker diagnostic toolset, based on the scope in [docs/holmesgpt-typescript-mvp-plan.md](docs/holmesgpt-typescript-mvp-plan.md).

## Project status

Phase 3's bounded, evidence-safe investigation engine is in place alongside
the Phase 1 contracts and OpenAI-compatible Chat Completions provider. It can
investigate container lifecycle evidence through fixtures or one pinned local
Docker context: running/all container discovery, inspect, bounded logs, and
bounded historical events. `docker_images`, `docker_top`, `docker_history`,
and `docker_diff` remain registered but intentionally unavailable.

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
npm install
npm run check
npm test
```

Run a deterministic fixture investigation without a Docker daemon:

```bash
npm run dev -- ask "Why did checkout exit?" --fixture missing-env
```

The deterministic engine, Docker adapter, projection, fixture, and CLI tests
use scripted providers, in-memory registries, fake processes/timers, and fixed
observations; they need no Docker daemon. `npm test` also retains the Phase 1
provider integration suite, which requires `LLM_API_KEY` and network access.
It uses a real model, sends all Docker schemas, returns a mocked tool result,
and requires a final answer, but does not invoke Docker. It defaults to
OpenRouter's free-model router (`openrouter/free`) at
`https://openrouter.ai/api/v1`. Set `LLM_MODEL` to a tool-calling-capable model
if the default route does not support tool calls.

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
- `fixtures/`: fixed lifecycle observations for `missing-env`,
  `unhealthy-container`, and `insufficient-evidence`.
- `examples/docker/`: reserved for disposable live-Docker demonstrations; currently empty.
- `examples/kubernetes/`: legacy empty placeholder; Kubernetes is out of scope.

## Documentation

- [Scope and implementation plan](docs/holmesgpt-typescript-mvp-plan.md)
- [Current-state implementation plan](docs/current-state-implementation-plan.md)
- [Phase 2 evidence-safe engine implementation slices](docs/phase-2-implementation-slices.md)
- [Phase 3 safe Docker lifecycle implementation slices](docs/phase-3-implementation-slices.md)
- [Quickstart and current availability](docs/quickstart.md)
- [Upstream Docker port map](docs/upstream-port-map.md)
- [Security and data handling](docs/security-and-data-handling.md)
- [Investigation-target history](docs/investigation-target-candidates.md)
