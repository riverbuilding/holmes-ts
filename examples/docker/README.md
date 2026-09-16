# Disposable Docker lifecycle validation

This Compose example creates three credential-free containers for Phase 3 and
Phase 4 disposable live validation:

- `crashed` exits after emitting a fixed missing-configuration signal.
- `unhealthy` stays running but fails its health check.
- `writable` stays running after making one harmless writable-layer change
  under `/tmp`.

Run it only against a disposable local Docker context:

```bash
docker compose -f examples/docker/compose.yaml up -d
docker compose -f examples/docker/compose.yaml ps -a
```

Use the resulting container IDs with the fixed read-only Docker tools. For the
Phase 3 lifecycle check, query `docker_events` over a short, already-ended UTC
interval that covers the Compose start. Do not use `--follow` or a future event
endpoint. For Phase 4, use the public `alpine:3.21` image for image history,
run `docker_top` against `writable`, and run `docker_diff` after it starts.

Clean up after validation:

```bash
docker compose -f examples/docker/compose.yaml down --volumes --remove-orphans
```

The example deliberately has no environment variables, labels, mounted files,
ports, credentials, or production data. Do not add production configuration or
secrets to it.
