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
- A tool-calling-capable OpenAI-compatible model and its credentials only for
  `test:provider`, fixture evaluation, or an investigation.
- Docker CLI and an accessible local Docker context only for a live
  investigation; fixture investigations do not contact Docker.

The defaults are `openrouter/free` and `https://openrouter.ai/api/v1`.
`LLM_MODEL` must name a model that supports function/tool calling and
`LLM_BASE_URL` must be that provider's compatible base URL. Put local
credentials in ignored `.env` or inject them through CI secrets—never commit
them. The CLI does not load `.env` itself, so source it in the shell running an
external command.

## Verify the implementation

From a clean checkout, the deterministic gate needs only Node.js and npm:

```bash
npm ci
npm run check
npm test
git diff --check
```

It does not require credentials, network access, Python, Docker CLI, or a
Docker daemon. To run the explicit external provider checks, copy the sample,
fill the three provider values, and source it only in the current shell:

```bash
cp .env.example .env
# Edit .env with LLM_API_KEY, LLM_MODEL, and LLM_BASE_URL.
set -a; source .env; set +a
npm run test:provider
npm run evaluate:fixtures -- --runs 1 --report docs/evaluations/phase-5-fixture-evaluation-YYYY-MM-DD.json
```

`test:provider` makes real network requests but never contacts Docker. Fixture
evaluation also makes real network requests and can incur provider usage; it
runs each of the five fixtures once by default and never starts Docker or
requires Python. See the [evaluation workflow](evaluations/README.md) before
using `--verbose`, because its diagnostic transcript can contain model prose
and fixture observations.

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

The result begins with `Status: complete` or `Status: partial` and then renders
`Finding`, `Evidence`, `Retained evidence`, `Next steps`, and `Uncertainty`.
Citation warnings identify unknown, duplicate, malformed, or absent citations;
they do not repair the model's claim or establish that a cited claim is true.
A completed process exit only means the CLI rendered an investigation result.
Invalid arguments, configuration failures, and startup failures exit nonzero.

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
