# Quickstart

## Current availability

`holmes-ts` is not yet able to run an investigation. The checked-in CLI parses
`ask` arguments and validates `LLM_API_KEY` and `LLM_MODEL`, but the provider,
Docker backend, and fixture backend are placeholders. The commands below are
safe development checks, not a working diagnostic demo.

## Prerequisites

- Node.js 24 or later.
- npm.

`npm test` includes a required authenticated real-model provider integration
test. It makes OpenAI-compatible Chat Completions requests and therefore
requires a valid `LLM_API_KEY`; `LLM_MODEL` must name a model that supports
function/tool calling; and `LLM_BASE_URL` must be that provider's compatible
base URL. The defaults are `openrouter/free` and
`https://openrouter.ai/api/v1`. Put local credentials in ignored `.env` or
inject them through CI secrets—never commit them.

The integration test sends the nine public Docker schemas, requires the model
to call `docker_ps_all`, returns a mocked tool result, and requires a final
model answer. It does not contact a Docker daemon or execute any Docker
command. The same suite separately verifies provider HTTP errors, timeout, and
caller cancellation against the selected endpoint.

## Verify the skeleton

```bash
npm install
export LLM_API_KEY=...              # or place it in ignored .env
export LLM_MODEL=provider/model     # tool-calling capable
export LLM_BASE_URL=https://provider.example/v1
npm run check
npm test
```

Use the provider's real endpoint for this acceptance test; a local HTTP mock
does not meet the Phase 1 provider-round-trip gate.

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
