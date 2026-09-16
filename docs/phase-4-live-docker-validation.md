# Phase 4 disposable live-Docker validation

Date: September 16, 2026
Status: passed

This record covers the credential-free disposable example in
[`examples/docker`](../examples/docker/README.md). It is an operational
validation supplement to the deterministic test suite, not a fixture or a
real-model evaluation.

## Example scope

`compose.yaml` defines three public-`alpine:3.21`, credential-free containers:

- `crashed` exits with a fixed, non-secret missing-configuration message.
- `unhealthy` remains running with an intentionally failing health check.
- `writable` remains running after writing a fixed marker below `/tmp`.

The validation is limited to the startup-pinned context and the fixed
read-only `docker_images`, `docker_history`, `docker_top`, and `docker_diff`
operations. It uses no `docker exec`, writes through the tool boundary,
labels, mounts, environment values, ports, credentials, or production data.

## Evidence-retention policy

The completed record retains Docker/Compose versions, host OS, selected
context, commands exercised, and projected success/error outcomes with counts
only. It must not retain container IDs, raw image rows, raw history commands,
raw process rows, raw diff paths, inspect output, logs, labels, or secrets.

## Environment facts recorded

| Fact | Observed value |
| --- | --- |
| Host OS | Darwin 26.5.2 arm64 |
| Docker CLI client | 29.6.1 |
| Docker Compose client | v5.3.0 |
| Selected context | `desktop-linux` |
| Docker Engine | 29.6.1 |
| Docker Desktop | Docker Desktop |

## Commands and result

All operational commands were executed through the product's
`DockerCli`/registered tools after resolving the context once. The validation
harness emitted only status, resource kind, and projected item counts.

| Command or check | Result |
| --- | --- |
| `npm run check` | Passed. |
| `npm test` | Passed. |
| `docker context show` | Resolved `desktop-linux`. |
| `docker info --format '{{.ServerVersion}}|{{.OperatingSystem}}'` | Reported `29.6.1|Docker Desktop`. |
| `docker compose version` | Reported `Docker Compose version v5.3.0`. |
| `docker compose -f examples/docker/compose.yaml up -d` | Started the three disposable services. |
| `docker_images` | Returned a projected success with 7 retained image rows and no truncation. |
| `docker_history` for `alpine:3.21` | Returned a projected success with 2 retained history rows and no truncation. |
| `docker_top` for running `writable` | Returned a projected success with 2 retained process rows and no truncation. |
| `docker_diff` for `writable` | Returned a projected success with 3 retained change rows and no truncation. |
| Absent-resource `docker_diff` check | Returned the safe `not-found` result. |
| `docker compose -f examples/docker/compose.yaml down --volumes --remove-orphans` | Removed all three disposable containers and their network. |

The record intentionally omits raw Docker output and the identifiers used by
the harness. The successful writable-layer observation demonstrates only that
the controlled change was returned; it does not attribute application behavior
or infer a cause from a filesystem path.
