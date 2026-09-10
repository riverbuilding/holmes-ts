# holmes-ts

A TypeScript port of HolmesGPT's complete local-Docker diagnostic toolset, based on the scope in [docs/holmesgpt-typescript-mvp-plan.md](docs/holmesgpt-typescript-mvp-plan.md).

## Project status

The Phase 1 contracts and OpenAI-compatible Chat Completions provider are in
place, including an authenticated real-model tool-call round trip. Docker and
fixture execution remain intentionally unimplemented, so neither fixture nor
live-Docker investigations run yet.

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

Set `LLM_API_KEY` before running `npm test`: the provider integration suite
uses a real model, sends the Docker schemas, returns a mocked tool result, and
requires a final answer. It does not invoke Docker. It defaults to OpenRouter's
free-model router (`openrouter/free`) at `https://openrouter.ai/api/v1`. Set
`LLM_MODEL` to a tool-calling-capable model if the default route does not
support tool calls.

## Current layout

- `src/cli.ts` and `src/config.ts`: command parsing and environment validation.
- `src/core/`: bounded investigation-loop contracts and implementation.
- `src/llm/`: provider interface and OpenAI-compatible Chat Completions adapter.
- `src/tools/`: registry plus unimplemented Docker and fixture factories.
- `src/prompts/`: attributed local-Docker investigation prompt.
- `src/output/`: terminal-result rendering.
- `src/tests/`: deterministic investigation-loop test.
- `fixtures/`: reserved for fixed Docker-observation scenarios; currently empty.
- `examples/docker/`: reserved for disposable live-Docker demonstrations; currently empty.
- `examples/kubernetes/`: legacy empty placeholder; Kubernetes is out of scope.

## Documentation

- [Scope and implementation plan](docs/holmesgpt-typescript-mvp-plan.md)
- [Current-state implementation plan](docs/current-state-implementation-plan.md)
- [Quickstart and current availability](docs/quickstart.md)
- [Upstream Docker port map](docs/upstream-port-map.md)
- [Security and data handling](docs/security-and-data-handling.md)
- [Investigation-target history](docs/investigation-target-candidates.md)
