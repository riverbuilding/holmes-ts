# Phase 3 disposable live-Docker validation

Date: September 15, 2026
Status: passed

This record covers the disposable example in
[`examples/docker`](../examples/docker/README.md). It is an operational
validation supplement to the deterministic test suite, not a fixture or a
real-model evaluation.

## Example scope

`compose.yaml` defines exactly two credential-free Alpine containers:

- `crashed` exits with a fixed, non-secret missing-configuration message.
- `unhealthy` remains running and has an intentionally failing health check.

The validation run is limited to context resolution/pinning and the existing
read-only lifecycle tools: `docker_ps`, `docker_ps_all`, `docker_inspect`,
`docker_logs`, and `docker_events`. It does not exercise `docker exec`, writes,
image/runtime tools, or an unbounded log/event stream.

## Environment facts recorded

| Fact | Observed value |
| --- | --- |
| Host OS | Darwin 25.5.0 arm64 |
| Docker CLI client | 29.6.1 |
| Docker Compose client | v5.3.0 |
| Selected context | `desktop-linux` |
| Docker Engine | 29.6.1 |
| Docker Desktop | Docker Desktop |

## Commands and result

| Command or check | Result |
| --- | --- |
| `npm run check` | Passed. |
| `npm test` | Passed: 77 tests. |
| `docker context show` | Resolved `desktop-linux`. |
| `docker info --format '{{.ServerVersion}}|{{.OperatingSystem}}'` | Reported `29.6.1|Docker Desktop`. |
| `docker compose version` | Reported `Docker Compose version v5.3.0`. |
| `docker compose -f examples/docker/compose.yaml up -d` | Started the disposable `crashed` and `unhealthy` containers. |
| `docker_ps` and `docker_ps_all` | Both returned projected successes through the pinned context; running discovery retained one container and all-container discovery retained five. |
| `docker_inspect` | Projected `crashed` as exited with exit code 1 and `unhealthy` as running with unhealthy health. |
| `docker_logs` | Projected one timestamped line with tail 10; log content was not recorded here. |
| `docker_events` | Projected three events for `crashed` in the bounded ended window `2026-09-16T03:10:12.971Z` to `2026-09-16T03:15:11.968Z`, with limit 10. |
| Absent-resource check | `docker_inspect` returned the safe `not-found` result for a fixed nonexistent identifier. |
| `docker compose -f examples/docker/compose.yaml down --volumes --remove-orphans` | Removed both disposable containers and their network. |

The record retains only projected outcome counts and safe state fields. It does
not commit raw inspect output, container IDs, labels, event attributes, or log
contents.
