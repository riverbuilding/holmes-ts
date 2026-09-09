# holmes-ts

A TypeScript port of HolmesGPT's complete local-Docker diagnostic toolset, based on the scope in [docs/holmesgpt-typescript-mvp-plan.md](docs/holmesgpt-typescript-mvp-plan.md).

## Project status

This repository currently contains a compiling project skeleton. The CLI parses
arguments and validates configuration; the investigation loop and its scripted
test exist. The model provider plus the Docker and fixture backends are still
unimplemented placeholders, so neither fixture nor live-Docker investigations
run yet.

## Development

```bash
npm install
npm run check
npm test
```

The planned command, once the provider and fixture backend are implemented, is:

```bash
npm run dev -- ask "Why did checkout exit?" --fixture missing-env
```

Set `LLM_API_KEY` and `LLM_MODEL` before implementing or using a live model provider.

## Current layout

- `src/cli.ts` and `src/config.ts`: command parsing and environment validation.
- `src/core/`: bounded investigation-loop contracts and implementation.
- `src/llm/`: provider interface and an unimplemented OpenAI-compatible adapter.
- `src/tools/`: registry plus unimplemented Docker and fixture factories.
- `src/prompts/`: the current minimal investigation prompt.
- `src/output/`: terminal-result rendering.
- `src/tests/`: deterministic investigation-loop test.
- `fixtures/`: reserved for fixed Docker-observation scenarios; currently empty.
- `examples/docker/`: reserved for disposable live-Docker demonstrations; currently empty.
- `examples/kubernetes/`: legacy empty placeholder; Kubernetes is out of scope.

## Documentation

- [Scope and implementation plan](docs/holmesgpt-typescript-mvp-plan.md)
- [Quickstart and current availability](docs/quickstart.md)
- [Upstream Docker port map](docs/upstream-port-map.md)
- [Security and data handling](docs/security-and-data-handling.md)
- [Investigation-target history](docs/investigation-target-candidates.md)
