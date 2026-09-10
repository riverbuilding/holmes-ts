# Quickstart

## Current availability

`holmes-ts` is not yet able to run an investigation. The checked-in CLI parses
`ask` arguments and validates `LLM_API_KEY` and `LLM_MODEL`, but the provider,
Docker backend, and fixture backend are placeholders. The commands below are
safe development checks, not a working diagnostic demo.

## Prerequisites

- Node.js 24 or later.
- npm.

`npm test` includes a real-model provider integration test and therefore
requires `LLM_API_KEY`. The test itself does not require Docker. Never commit
model credentials.

## Verify the skeleton

```bash
npm install
npm run check
npm test
```

Set `LLM_MODEL` to a tool-calling-capable model if the default provider route
does not support tool calls.

## Planned investigation workflow

After the implementation milestones are complete, a fixture investigation will
use fixed Docker observations and require no Docker daemon:

```bash
npm run dev -- ask "Why did checkout exit?" --fixture missing-env
```

A live investigation will target exactly one local Docker context:

```bash
npm run dev -- ask "Why did checkout exit?" --docker-context desktop-linux --verbose
```

Both commands require `LLM_API_KEY`. The default model is
`openrouter/free` and the default endpoint is `https://openrouter.ai/api/v1`;
`LLM_MODEL` and `LLM_BASE_URL` can override them. The agent will remain
read-only: it will not execute Docker writes, `docker exec`, or remediation.

## Fixture versus live Docker

Fixture directories will contain deterministic tool responses (such as logs,
inspect projections, and events). They are not Docker images or running
containers. The future `examples/docker/` demo will provide intentionally
broken real containers for live validation.

For the complete delivery plan, see
[the local-Docker diagnostics scope](holmesgpt-typescript-mvp-plan.md).
