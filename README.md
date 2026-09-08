# holmes-ts

A TypeScript MVP for evidence-backed Docker troubleshooting, based on the scope in [docs/holmesgpt-typescript-mvp-plan.md](docs/holmesgpt-typescript-mvp-plan.md).

## Project status

This repository currently contains a compiling project skeleton. The CLI parses arguments and validates configuration, but the model provider and Docker tools are deliberately unimplemented placeholders until milestone 1 is completed.

## Development

```bash
npm install
npm run check
npm test
```

The intended command is:

```bash
npm run dev -- ask "Why did checkout exit?" --fixture missing-env
```

Set `LLM_API_KEY` and `LLM_MODEL` before implementing or using a live model provider.

## Layout

- `src/core`: investigation loop contracts and orchestration
- `src/llm`: provider boundary and the first OpenAI-compatible adapter
- `src/tools`: tool registry and Docker/fixture backends
- `src/prompts`: system prompts
- `src/output`: terminal rendering
- `src/tests`: deterministic tests using no network or credentials
- `fixtures`: scenario observations for the MVP demos
- `examples/docker`: future disposable Docker Compose demo
