# HolmesGPT fixture YAML reference

This records the YAML layout under HolmesGPT's `tests/llm/fixtures/test_ask_holmes` directory as inspected on upstream master commit [`73fda86`](https://github.com/HolmesGPT/holmesgpt/commit/73fda86737a68e90c97a2eb7496bc3f279422ec9).

The directory contains 642 YAML files. Their framework roles are below.

| Category | Count | Function |
| --- | ---: | --- |
| `test_case.yaml` | 275 | Eval definition. It supplies the prompt, expected answer criteria, setup and cleanup scripts, tags, timeouts, conversation/tool-call constraints, and optional toolset matrix. The loader reads this exact filename from each test-case directory. |
| `toolsets.yaml` | 183 | Per-case toolset configuration. It enables and configures builtin toolsets or declares HTTP, database, and MCP toolsets. Holmes merges it with default toolsets; explicitly configured entries override the defaults. |
| `toolsets_mcp.yaml`, `toolsets_http.yaml` | 4 | Alternative toolset configurations. A `toolsets_matrix` entry in `test_case.yaml` selects each variant, causing the case to run once for every listed configuration. |
| Workload/support YAML | 179 | Scenario data rather than harness configuration: Kubernetes manifests, Helm values, Docker Compose definitions, Loki/Prometheus configuration, database definitions, traffic generators, and similar resources. A case's setup script explicitly consumes them. |
| `test_case copy.yaml` | 1 | An unconsumed duplicate in `102a_loki_logs_transparency`; the loader looks only for the exact filename `test_case.yaml`. |

## How the files relate

```text
test_case.yaml
  |- defines the question, success criteria, and setup/cleanup
  |- optionally selects toolset configuration variants
  `- setup script explicitly applies or starts workload YAML

toolsets*.yaml
  `- controls the live investigation tools available to Holmes

manifest/deployment/compose/config YAML
  `- creates the live system and its failure symptoms
```

The workload/support group does not have harness-defined filename types. `manifest.yaml` and `manifests.yaml` are conventions, not filenames the framework discovers specially. The same is true for names such as `deployment.yaml`, `docker-compose.yaml`, `prometheus-config.yaml`, and `traffic-generator.yaml`.

The most common workload/support names are:

| Filename | Count |
| --- | ---: |
| `manifest.yaml` | 87 |
| `manifests.yaml` | 7 |
| `traffic-generator.yaml` | 6 |
| `deployment.yaml` | 5 |
| `prometheus-config.yaml` | 5 |
| `checkout-service.yaml` | 4 |

For example, a `manifest.yaml` is normally ordinary Kubernetes resource YAML. It participates in an eval only because `before_test` runs a command such as `kubectl apply -f manifest.yaml`. Likewise, a Compose YAML is used only when the setup script invokes Docker Compose.

## Implication for this port

The current TypeScript live-evaluation loader reads `test_case.yaml` only. It does not yet reproduce HolmesGPT's sidecar `toolsets.yaml` / `toolsets_matrix` mechanism, and it does not implicitly consume workload YAML. To match upstream behavior, those should be implemented as separate layers:

1. Load and validate the exact `test_case.yaml` file per case.
2. Select a sidecar toolset file, including matrix variants, and use it to configure the live tool registry.
3. Let `before_test` and `after_test` explicitly provision and clean up scenario resources.

## Upstream references

- [Fixture directory](https://github.com/HolmesGPT/holmesgpt/tree/master/tests/llm/fixtures/test_ask_holmes)
- [Test-case loader](https://github.com/HolmesGPT/holmesgpt/blob/master/tests/llm/utils/test_case_utils.py)
- [Test toolset manager](https://github.com/HolmesGPT/holmesgpt/blob/master/tests/llm/utils/test_toolset.py)
