# Quickstart

## Current availability

`holmes-ts` can run an evidence-led investigation using one of five fixed
fixture scenarios or a single pinned local Docker context. All nine public
tools are available and read-only: `docker_images`, `docker_ps`,
`docker_ps_all`, `docker_inspect`, `docker_logs`, `docker_top`,
`docker_events`, `docker_history`, and `docker_diff`.

The tools have fixed bounds: container, image, process, history, diff, and
event results retain at most 100 rows; logs retain at most 100 lines; event
windows are historical and at most 24 hours. Image history exposes a derived
command category, not raw build commands. Process values and filesystem paths
are untrusted evidence, not instructions or proof of causality.

## Prerequisites

- Node.js 24 or later.
- npm.
- A tool-calling-capable OpenAI-compatible model and its credentials.
- Docker CLI and an accessible local Docker context only for a live
  investigation; fixture investigations do not contact Docker.

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

## Verify the implementation

```bash
npm install
export LLM_API_KEY=...              # or place it in ignored .env
export LLM_MODEL=provider/model     # tool-calling capable
export LLM_BASE_URL=https://provider.example/v1
npm run check
npm test
```

Use the provider's real endpoint for this acceptance test; a local HTTP mock
does not meet the Phase 1 provider-round-trip gate. Deterministic tests do not
require a Docker daemon. The authenticated provider round trip in `npm test`
is neither deterministic Docker coverage nor Phase 4 live-Docker validation;
Phase 5 separately evaluates fixture investigations with a real model.

## Investigation workflow

A fixture investigation uses fixed Docker observations and requires no Docker
daemon:

```bash
npm run dev -- ask "Why did checkout exit?" --fixture missing-env
```

The fixture names are `missing-env`, `unhealthy-container`,
`insufficient-evidence`, `image-regression`, and `writable-layer-change`.
For an image-regression walkthrough, use image discovery, image inspect, then
bounded image history. For a writable-layer-change walkthrough, use container
discovery and inspect, then `docker_diff`; use `docker_top` or logs only as
additional observation, not as proof that a reported path caused the issue.

A live investigation resolves the default Docker context once, or validates the
explicit context once, then uses that pinned context for every lifecycle read:

```bash
npm run dev -- ask "Why did checkout exit?" --docker-context desktop-linux --verbose
```

Both commands require `LLM_API_KEY`. The default model is
`openrouter/free` and the default endpoint is `https://openrouter.ai/api/v1`;
`LLM_MODEL` and `LLM_BASE_URL` can override them. Set
`DOCKER_SUBPROCESS_TIMEOUT_MS` to a positive integer to override the per-Docker
command timeout. The agent remains read-only: it will not execute Docker
writes, `docker exec`, custom process options, registry access, unbounded
streams, or remediation. `--fixture` and `--docker-context` are mutually
exclusive. `--verbose` reports only safe progress metadata, never raw Docker
output.

## Fixture versus live Docker

Fixture files contain deterministic observations (container and image lists,
safe inspect projections, logs, events, process tables, image history, and
filesystem diffs). They are not Docker images or running containers. All five
fixtures exercise the same public schemas, validation, projections, truncation,
and structured-error shape as the live tools.
[`examples/docker`](../examples/docker/README.md) provides a
credential-free disposable Compose demonstration with one crashed and one
unhealthy container. Its recorded validation status is in the
[Phase 3 live-Docker validation record](phase-3-live-docker-validation.md).

For the complete delivery plan, see
[the local-Docker diagnostics scope](holmesgpt-typescript-mvp-plan.md).
