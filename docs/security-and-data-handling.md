# Security and data handling

## Docker authority

Docker socket/context access can be highly privileged. `holmes-ts` is designed
for an operator-controlled local Docker context, but its application-level
read-only restrictions do not reduce the permissions already granted to the
Docker CLI or socket.

The implemented lifecycle toolset permits only container listing, inspect,
timestamped bounded logs, and bounded historical events. It invokes the literal
`docker` executable using fixed argument arrays with `shell: false`; a model
cannot select an executable, context, subcommand, flag, or shell expression.
The context is resolved or validated once at startup and pinned for every live
operation. `docker_images`, `docker_top`, `docker_history`, and `docker_diff`
are not implemented. The application must not expose arbitrary shell commands,
`docker exec`, attach/copy, model-selected contexts, or Docker write commands.

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
projections omit environment-variable values and authentication material, and
replace label values with `<withheld>` when their key contains `secret`,
`token`, `password`, `passwd`, `credential`, `auth`, or `key`. No credential
values are inferred from Docker output for the engine's known-secret redaction.
Logs can still include secrets that were not supplied as known values; use
fixtures or sanitize the local environment when that is a concern.

## Limits and untrusted content

The engine bounds model/tool operation time, result characters, and total
accumulated evidence. The Docker adapter captures at most 1 MiB each of stdout
and stderr, bounds each subprocess by `DOCKER_SUBPROCESS_TIMEOUT_MS` (10 seconds
by default), and terminates a timed-out or cancelled child. Container and event
results retain at most 100 rows; logs use a validated tail of at most 100 lines;
and event windows may not exceed 24 hours or end in the future. Each operation
receives a derived abort signal for caller cancellation, the investigation-wide
deadline, and its local timeout. Results that settle after a stop cannot alter
history or evidence.

Docker output is evidence, not instructions: neither the agent nor the tool
runner should obey instructions embedded in a log line, label, image metadata,
or filesystem path. Citation validation only establishes that an answer refers
to retained evidence; it does not prove that the cited observation supports
the answer's conclusion.

See the [scope plan](holmesgpt-typescript-mvp-plan.md) for the target limits and
acceptance tests.
