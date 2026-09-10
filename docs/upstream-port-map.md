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
| `holmes/plugins/toolsets/docker.yaml` | `src/tools/docker.ts` | Retains the nine public Docker tool names and descriptions; schemas validate plain JSON arguments before a future backend is allowed to execute. |
| `holmes/plugins/prompts/generic_ask.jinja2` | `src/prompts/local-docker-investigate.ts` | Retains evidence-led investigation, logs, root-cause depth, remediation, concise style, and uncertainty guidance; removes all non-Docker guidance. |
| `holmes/plugins/prompts/base_user_prompt.jinja2` | `src/prompts/local-docker-investigate.ts` | Replaces Jinja time and user-prompt interpolation with a fixed system prompt; the caller supplies the user message separately. |
| `holmes/plugins/prompts/_toolsets_instructions.jinja2` | `src/prompts/local-docker-investigate.ts` | Replaces dynamic enabled/disabled toolset rendering with one fixed local-Docker capability boundary. |
| `holmes/core/tool_calling_llm.py` | `src/core/investigate.ts` | Uses bounded TypeScript message/tool-call turns, cancellation, structured errors, evidence IDs, and final synthesis. |
| `holmes/core/tools.py` and execution helpers | `src/core/types.ts`, `src/tools/registry.ts`, `src/tools/validation.ts` | Uses plain JSON Schema plus TypeScript parsing and structured results; does not port Python execution helpers. |

## Docker tool contract map

All tools originate in upstream `docker/core`. Their TypeScript schemas live in
`src/tools/docker.ts`; their argument parsers reject unknown keys, blank IDs,
and flag-like values before execution. Docker execution is intentionally absent
in Phase 1, so each current registration returns a structured `unavailable`
result rather than invoking Docker.

| Tool | Upstream behavior | TypeScript schema | Adaptation and current omission |
|---|---|---|---|
| `docker_images` | `docker images`: list all images. | Empty object; no properties. | Same read intent. No CLI execution or output projection yet. |
| `docker_ps` | `docker ps`: list running containers. | Empty object; no properties. | Same read intent. No CLI execution or output projection yet. |
| `docker_ps_all` | `docker ps -a`: list running and stopped containers. | Empty object; no properties. | Same read intent. No CLI execution or output projection yet. |
| `docker_inspect` | `docker inspect {{ container_or_image_id }}`: inspect a container or image. | Required `container_or_image_id`: non-empty identifier string. | Keeps the upstream singular parameter. Does not run Docker or expose raw inspect data yet. |
| `docker_logs` | `docker logs {{ container_id }}`: fetch container logs. | Required `container_id`: non-empty identifier; optional `tail`: integer 1–100, default 100. | Adds a bounded `tail` to protect evidence budgets. No CLI execution, stream following, timestamps, or other Docker log flags. |
| `docker_top` | `docker top {{ container_id }}`: display container processes. | Required `container_id`: non-empty identifier string. | Same read intent. No CLI execution or custom `ps` arguments. |
| `docker_events` | `docker events`: read Docker server events. | Required `since` and `until`: date-time strings; optional `container_id`: non-empty identifier; optional `limit`: integer 1–100, default 100. | Converts unbounded real-time streaming into a bounded historical window; no CLI execution or arbitrary event filters. |
| `docker_history` | `docker history {{ image_id }}`: show image history. | Required `image_id`: non-empty image reference; optional `limit`: integer 1–100, default 100. | Adds a bounded result limit. No CLI execution or arbitrary history flags. |
| `docker_diff` | `docker diff {{ container_id }}`: inspect container filesystem changes. | Required `container_id`: non-empty identifier string. | Same read intent. No CLI execution or filesystem mutation. |

## Deliberate omissions

This is not a general HolmesGPT port. Kubernetes, external integrations,
skills, TodoWrite, permissions workflows, dynamic toolset loading, plugins,
MCP, UI/server features, conversation persistence, Docker daemon discovery,
and all Docker-mutating operations are excluded. Phase 1 also excludes every
Docker command: model-provider integration uses a mocked `docker_ps_all` tool
result only.
