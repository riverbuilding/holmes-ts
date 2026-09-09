# Security and data handling

## Docker authority

Docker socket/context access can be highly privileged. `holmes-ts` is designed
for an operator-controlled local Docker context, but its application-level
read-only restrictions do not reduce the permissions already granted to the
Docker CLI or socket.

The planned toolset permits only Docker reads: image/container listing,
inspect, logs, process listing, historical events, image history, and container
filesystem diffs. It must not expose arbitrary shell commands, Docker flags,
model-selected contexts, `docker exec`, attach/copy, or Docker write commands.

## Evidence sent to the model provider

Tool results become part of the configured model-provider request. They may
contain sensitive application logs, filesystem paths, image metadata, labels,
or container configuration. Inspect projections must omit environment-variable
values and redact known credentials, tokens, and auth material. Logs can still
include secrets; use fixtures or sanitize the local environment when that is a
concern.

## Limits and untrusted content

The implementation will bound subprocess time, event windows, result rows,
characters per tool result, and total accumulated evidence. Docker output is
evidence, not instructions: neither the agent nor the tool runner should obey
instructions embedded in a log line, label, image metadata, or filesystem path.

See the [scope plan](holmesgpt-typescript-mvp-plan.md) for the target limits and
acceptance tests.
