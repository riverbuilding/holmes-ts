# Upstream Docker port map

## Baseline

This project ports the local-Docker diagnostic subset of HolmesGPT revision
[`5e983c17f30e93099c7d775167266d4cd1d586c4`](https://github.com/HolmesGPT/holmesgpt/tree/5e983c17f30e93099c7d775167266d4cd1d586c4).
The upstream project is Apache-2.0. This document records the intended semantic
mapping; it does not mean the corresponding TypeScript implementation exists.

## Included sources

| Upstream source | TypeScript destination | Treatment |
|---|---|---|
| `holmes/plugins/toolsets/docker.yaml` | `src/tools/docker.ts`, `src/tools/docker-cli.ts` | Port all nine read-only `docker/core` tool names and diagnostic intent with validated, fixed Docker arguments. |
| `holmes/plugins/prompts/generic_ask.jinja2` | `src/prompts/local-docker-investigate.ts` | Adapt only Docker-relevant evidence, investigation-depth, logs, uncertainty, and remediation guidance. |
| `holmes/plugins/prompts/base_user_prompt.jinja2` | `src/prompts/local-docker-investigate.ts` | Preserve relevant question/time-context behavior without Jinja or skills support. |
| `holmes/plugins/prompts/_toolsets_instructions.jinja2` | `src/prompts/local-docker-investigate.ts` | Replace dynamic toolset rendering with one fixed local-Docker capability description. |
| `holmes/core/tool_calling_llm.py` | `src/core/investigate.ts` | Port bounded tool-call/result conversation behavior, errors, cancellation, and final synthesis semantics. |
| `holmes/core/tools.py` and direct execution helpers | `src/core/types.ts`, `src/tools/registry.ts` | Port typed tool contracts, validation, structured results, and call/result identity. |

## Included Docker tools

`docker_images`, `docker_ps`, `docker_ps_all`, `docker_inspect`, `docker_logs`,
`docker_top`, `docker_events`, `docker_history`, and `docker_diff`.

## Deliberate omissions

Kubernetes, external integrations, skills, TodoWrite, permissions, dynamic
toolset loading, plugins, MCP, UI/server features, conversation persistence,
and all Docker-mutating operations remain outside this port.

## Attribution requirement

When upstream text is copied or materially adapted, add a source comment or
header naming the upstream path, pinned revision, Apache-2.0 license, and the
TypeScript-specific changes. Include upstream license and notices before any
distribution.
