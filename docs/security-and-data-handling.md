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
or container configuration. The Phase 2 engine sends only retained evidence:
explicitly supplied known secret values are replaced before storage, character
counting, or forwarding to the model. It then applies a per-result cap and a
total investigation evidence cap, retaining only deterministic prefixes and
annotating source and engine truncation. Successful output that cannot retain
any content receives no evidence ID and is not citeable.

This is deliberately exact-value redaction, not credential detection. Inspect
projections must still omit environment-variable values and Phase 3 must supply
known credentials, tokens, and auth material for redaction. Logs can still
include secrets that were not supplied as known values; use fixtures or
sanitize the local environment when that is a concern.

## Limits and untrusted content

The engine bounds model/tool operation time, result characters, and total
accumulated evidence; the Docker adapter will additionally bound subprocess
time, event windows, and result rows. Each operation receives a derived abort
signal for caller cancellation, the investigation-wide deadline, and its local
timeout. Results that settle after a stop cannot alter history or evidence.

Docker output is evidence, not instructions: neither the agent nor the tool
runner should obey instructions embedded in a log line, label, image metadata,
or filesystem path. Citation validation only establishes that an answer refers
to retained evidence; it does not prove that the cited observation supports
the answer's conclusion.

See the [scope plan](holmesgpt-typescript-mvp-plan.md) for the target limits and
acceptance tests.
