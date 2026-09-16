# Disposable Docker lifecycle validation

This Compose example creates two intentionally broken, credential-free
containers for Phase 3 live validation:

- `crashed` exits after emitting a fixed missing-configuration signal.
- `unhealthy` stays running but fails its health check.

Run it only against a disposable local Docker context:

```bash
docker compose -f examples/docker/compose.yaml up -d
docker compose -f examples/docker/compose.yaml ps -a
```

Use the resulting container IDs with `docker_inspect` and `docker_logs`.
Query `docker_events` over a short, already-ended UTC interval that covers the
Compose start. Do not use `--follow` or a future event endpoint.

Clean up after validation:

```bash
docker compose -f examples/docker/compose.yaml down --volumes --remove-orphans
```

The example deliberately has no environment variables, labels, mounted files,
ports, or credentials. Do not add production configuration or secrets to it.
