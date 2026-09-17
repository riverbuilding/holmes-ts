# Phase 1 implementation slices

Date: September 9, 2026  
Status: ready to implement

This document decomposes Phase 1 from
[the current-state implementation plan](current-state-implementation-plan.md)
into small, independently mergeable slices. Phase 1 freezes the external
contracts and proves an OpenAI-compatible provider round trip with a real
model before Docker
execution work begins.

## Provider decision

Use the OpenAI-compatible **Chat Completions** protocol at
`/v1/chat/completions` as the pinned provider contract. It directly represents
system, user, assistant, and tool messages and function/tool calls. This is a
single tested compatibility target; it is not a commitment to LiteLLM or the
Responses API.

## Slice sequence

| Slice                                              | Deliverable                                                                                                                                                                                                                                                                                                                                                                                                  | Primary files                                                                                                     | Completion criteria                                                                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Freeze core contracts                           | Replace the skeletal message, tool-call, tool-result/error, evidence, truncation, and limit types. Set defaults to 12 model calls, 24 tool calls, 180-second deadline, 30-second model timeout, 10-second subprocess timeout, 100 rows/log lines, 16,000 characters per result, and 96,000 total evidence characters.                                                                                        | `src/core/types.ts`                                                                                               | Type-check passes and focused contract tests compile representative successful, error, and tool-call histories.                                |
| 2. Define registry boundary                        | Make the registry the sole owner of JSON schemas, argument parsing, and dispatch lookup. Add reusable validators for object shape, unknown keys, identifiers, image references, positive bounded integers, timestamps/windows, and flag-like input.                                                                                                                                                          | `src/tools/registry.ts`, `src/tools/validation.ts`                                                                | Tests prove invalid, unknown, and flag-like input is rejected before an executor can be invoked.                                               |
| 3. Add all nine public schemas                     | Implement schemas and parsers only&mdash;no Docker execution yet&mdash;for `docker_images`, `docker_ps`, `docker_ps_all`, `docker_inspect`, `docker_logs`, `docker_top`, `docker_events`, `docker_history`, and `docker_diff`. Preserve upstream names and singular resource parameter names.                                                                                                                | `src/tools/docker.ts`                                                                                             | Table-driven accept/reject tests cover every tool, parameter default, upper bound, unknown key, empty ID, and `-`-prefixed value.              |
| 4. Pin provider interface                          | Change `respond` to accept an `AbortSignal`; define normalized, non-secret provider errors: `timeout`, `cancelled`, `transport`, `invalid-response`, and `http`. Provider call IDs are mandatory.                                                                                                                                                                                                            | `src/llm/provider.ts`, `src/core/types.ts`                                                                        | Existing engine tests use the explicit provider contract and no longer depend on implicit behavior.                                            |
| 5. Implement provider HTTP adapter                 | Use built-in `fetch`; normalize the base URL, add bearer authentication, map messages and tool schemas losslessly, parse assistant content and `tool_calls`, and compose caller cancellation with the model timeout. Credentials must never appear in error text.                                                                                                                                            | `src/llm/openai-compatible-provider.ts`, `src/config.ts`                                                          | An authenticated call to the configured real OpenAI-compatible endpoint returns normalized assistant text and tool calls.                      |
| 6. Prove the real-model provider round trip        | Add an authenticated integration test against the configured real model. Verify the initial request supplies tool schemas; the model selects `docker_ps_all` and supplies its provider call ID; the next request carries the assistant tool call plus the matching mocked tool result; and the model returns a final answer. Cover real-endpoint HTTP failures, timeout, and caller cancellation separately. | `src/tests/openai-compatible-provider.test.ts`                                                                    | The normal provider round trip uses a real model and real credentials; it is not satisfied by a local HTTP mock. No Docker daemon is required. |
| 7. Add prompt, provenance, and real-model coverage | Replace the minimal prompt with the attributed local-Docker prompt. Expand the port map to list each tool's upstream behavior, TypeScript schema, adaptations, and omissions. Add Apache-2.0 license/notice material. Document the required authenticated test configuration and run the full suite against the selected provider.                                                                           | `src/prompts/local-docker-investigate.ts`, `docs/upstream-port-map.md`, `LICENSE`, `NOTICE`, `docs/quickstart.md` | `npm test` (with real-model credentials) and `npm run check` pass. No Docker command is run in this phase.                                     |

## Contract decisions and guardrails

- Treat malformed tool arguments received from a provider as a normalized
  tool-call payload. The registry must turn them into a structured tool error.
  Use `invalid-response` only for invalid protocol envelopes, missing call IDs,
  or otherwise unusable provider responses.
- Represent successful evidence and safe tool errors structurally from the
  outset; each must retain the originating `toolCallId`.
- Keep each public schema as plain JSON Schema plus a TypeScript parser. Do not
  add a validation-library dependency unless the team separately chooses one.
- Do not introduce Docker execution for a Phase 1 test. The required live
  model round trip is provider to mocked `docker_ps_all` result to provider
  final response. Live Docker begins in Phase 3.
- Every test that exercises model behavior or the provider integration must
  call the configured real model. `LLM_API_KEY` is therefore required for
  `npm test`; `LLM_MODEL` and `LLM_BASE_URL` select the compatibility target.
  The selected model must support OpenAI-compatible tool calling.
  Unit tests for contracts, schemas, and input validation remain local because
  they make no model request.
- Keep narrowly scoped local tests for synthetic protocol failures that a real
  provider cannot be instructed to emit (for example, malformed JSON). They
  verify defensive parsing only and must not stand in for the real-model
  round-trip acceptance test.

## Recommended pull-request order

1. Slices 1 and 4 together: core types and provider interface.
2. Slice 2: registry and shared validation.
3. Slice 3: all public schemas and schema tests.
4. Slice 5: HTTP provider implementation.
5. Slice 6: authenticated real-model provider round-trip test suite.
6. Slice 7: attributed prompt, provenance, licensing, and required real-model
   coverage.

Slice 6 is the technical Phase 1 gate. Slice 7 completes the provenance and
required real-provider test coverage.
