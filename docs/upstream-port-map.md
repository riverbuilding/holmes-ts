# Upstream Docker port map

## Baseline and attribution

This project ports the local-Docker diagnostic subset of HolmesGPT revision
[`5e983c17f30e93099c7d775167266d4cd1d586c4`](https://github.com/HolmesGPT/holmesgpt/tree/5e983c17f30e93099c7d775167266d4cd1d586c4).
The upstream project is licensed under Apache-2.0. `LICENSE` carries that
license text and `NOTICE` records the retained upstream attribution. This map
describes semantic compatibility, not an assertion that every upstream feature
or command is present in TypeScript.

## Source-level mapping

| Upstream source | TypeScript destination | TypeScript-specific adaptation |
|---|---|---|
| `holmes/plugins/toolsets/docker.yaml` | `src/tools/docker.ts`, `src/tools/docker-cli.ts`, `src/tools/docker-projection.ts` | Retains the nine public Docker tool names and descriptions; five lifecycle tools execute fixed read-only Docker argument arrays and project safe evidence. |
| `holmes/plugins/prompts/generic_ask.jinja2` | `src/prompts/local-docker-investigate.ts` | Retains evidence-led investigation, logs, root-cause depth, remediation, concise style, and uncertainty guidance; removes all non-Docker guidance. |
| `holmes/plugins/prompts/base_user_prompt.jinja2` | `src/prompts/local-docker-investigate.ts` | Replaces Jinja time and user-prompt interpolation with a fixed system prompt; the caller supplies the user message separately. |
| `holmes/plugins/prompts/_toolsets_instructions.jinja2` | `src/prompts/local-docker-investigate.ts` | Replaces dynamic enabled/disabled toolset rendering with one fixed local-Docker capability boundary. |
| `holmes/core/tool_calling_llm.py` | `src/core/investigate.ts` | Uses bounded TypeScript message/tool-call turns, cancellation, structured errors, evidence IDs, and final synthesis. |
| `holmes/core/tools.py` and execution helpers | `src/core/types.ts`, `src/tools/registry.ts`, `src/tools/validation.ts` | Uses plain JSON Schema plus TypeScript parsing and structured results; does not port Python execution helpers. |

## Docker tool contract map

All tools originate in upstream `docker/core`. Their TypeScript schemas live in
`src/tools/docker.ts`; their argument parsers reject unknown keys, blank IDs,
and flag-like values before execution. Five lifecycle registrations execute
through `src/tools/docker-cli.ts` using fixed read-only argument arrays and one
startup-pinned Docker context. Their raw output is projected before becoming
tool evidence. The four remaining registrations return a structured
`unavailable` result.

| Tool | Upstream behavior | TypeScript schema | Adaptation and current omission |
|---|---|---|---|
| `docker_images` | `docker images`: list all images. | Empty object; no properties. | Registered but unavailable; image discovery is deferred. |
| `docker_ps` | `docker ps`: list running containers. | Empty object; no properties. | Executes `docker --context <pinned> container ls --format {{json .}}`; safe projected rows are capped at 100. |
| `docker_ps_all` | `docker ps -a`: list running and stopped containers. | Empty object; no properties. | Executes the same fixed listing with `--all`; safe projected rows are capped at 100. |
| `docker_inspect` | `docker inspect {{ container_or_image_id }}`: inspect a container or image. | Required `container_or_image_id`: non-empty identifier string. | Executes a fixed inspect read and projects selected container/image metadata; environment values and sensitive label values are omitted or withheld. |
| `docker_logs` | `docker logs {{ container_id }}`: fetch container logs. | Required `container_id`: non-empty identifier; optional `tail`: integer 1–100, default 100. | Executes fixed `container logs --timestamps --tail`; it never follows a stream and retains at most the requested bounded tail. |
| `docker_top` | `docker top {{ container_id }}`: display container processes. | Required `container_id`: non-empty identifier string. | Registered but unavailable; no custom `ps` arguments are accepted. |
| `docker_events` | `docker events`: read Docker server events. | Required `since` and `until`: date-time strings; optional `container_id`: non-empty identifier; optional `limit`: integer 1–100, default 100. | Executes fixed historical `events --since --until` with an optional fixed container filter. It never follows a stream; the window is at most 24 hours and results are capped at the requested limit. |
| `docker_history` | `docker history {{ image_id }}`: show image history. | Required `image_id`: non-empty image reference; optional `limit`: integer 1–100, default 100. | Registered but unavailable; image history is deferred. |
| `docker_diff` | `docker diff {{ container_id }}`: inspect container filesystem changes. | Required `container_id`: non-empty identifier string. | Registered but unavailable; no filesystem mutation is possible. |

## Deliberate omissions

This is not a general HolmesGPT port. Kubernetes, external integrations,
skills, TodoWrite, permissions workflows, dynamic toolset loading, plugins,
MCP, UI/server features, conversation persistence, Docker daemon discovery,
and all Docker-mutating operations are excluded. Phase 3 implements only the
five lifecycle reads described above; fixture scenarios reuse their public
schemas and safe projections without contacting Docker. The provider
integration test continues to use a mocked `docker_ps_all` result only.
