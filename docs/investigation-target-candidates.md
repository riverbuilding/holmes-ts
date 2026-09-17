# Investigation-target candidates

Date: September 8, 2026  
Decision: local Docker diagnostics is the selected TypeScript port target.
MySQL is a possible later target; Elasticsearch is deferred.

HolmesGPT’s investigation engine is not tied to Kubernetes. It gives an LLM a small set of read-only tools, feeds tool results back into the conversation, and asks it to form an evidence-backed diagnosis. The tool implementation determines what is being investigated.

## Candidate comparison

| Candidate                  | Questions the MVP can answer                                                   | Setup and domain complexity                                            | Recommendation                                             |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Docker                     | Why did a container exit? What does its startup log say? What changed?         | Low; works on a developer laptop with Docker.                          | First MVP.                                                 |
| MySQL                      | Why is an order lookup slow? Which index is missing? Which query is expensive? | Medium; requires a sample schema and knowledge of SQL/execution plans. | Best second target for backend/database experience.        |
| Elasticsearch / OpenSearch | Why did requests fail? Which log events occurred? Why are shards unassigned?   | Medium-high; requires index, mapping, Query DSL, and cluster concepts. | Defer unless search/log observability is already familiar. |

## Docker: selected port target

Docker is the selected local-Docker port target because each diagnostic operation
maps directly to a Docker CLI command and failures are reproducible on a
developer machine. The scope ports every read-only operation in upstream
HolmesGPT's `docker/core` toolset: listing images and containers, inspecting a
container or image, reading logs, listing processes, reading events, viewing
image history, and inspecting filesystem changes. See the [current scope and
implementation plan](holmesgpt-typescript-mvp-plan.md) for the compatibility
boundary and the [Docker toolset](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/docker/).

The TypeScript port preserves these nine upstream tool names:

| Tool             | Read-only operation                                           | Diagnostic use                                    |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------- |
| `docker_images`  | `docker images` with a fixed output projection                | Discover image inventory and tags.                |
| `docker_ps`      | `docker ps` with a fixed output projection                    | Discover running containers.                      |
| `docker_ps_all`  | `docker ps -a` with a fixed output projection                 | Discover stopped and exited containers.           |
| `docker_inspect` | `docker inspect` for a validated container or image reference | Read selected structured state and configuration. |
| `docker_logs`    | Bounded `docker logs` for a validated container               | Collect application/runtime evidence.             |
| `docker_top`     | `docker top` for a validated running container                | Inspect current processes.                        |
| `docker_events`  | Bounded historical `docker events`                            | Explain lifecycle and health chronology.          |
| `docker_history` | Bounded `docker history` for a validated image                | Inspect layer provenance and changes.             |
| `docker_diff`    | Bounded `docker diff` for a validated container               | Inspect writable-layer changes.                   |

The tool registry will construct argument arrays without a shell. It will reject unknown flags and invalid container identifiers, set subprocess timeouts, bound output, and never expose `docker exec`, `docker run`, `docker rm`, `docker stop`, `docker restart`, `docker build`, or any write operation.

Fixture scenarios are fixed observations—not images or containers. They cover
missing configuration, an unhealthy container, writable-layer changes, an image
regression, and insufficient evidence. A separate disposable Docker
demonstration will validate the same tool schemas against real containers.

## MySQL: recommended next target

MySQL is the best follow-up if the project owner is comfortable with backend applications and SQL. HolmesGPT’s MySQL integration supports query-performance analysis, slow-query investigation, index analysis, health inspection, and troubleshooting reads. It defaults to read-only SQL and allows `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`, and `WITH` statements. [MySQL toolset](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/database-mysql/)

An appropriate MySQL MVP would expose five constrained tools:

| Tool                      | Evidence returned                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `mysql_server_info`       | Connectivity, version, uptime, and selected server status counters.                                 |
| `mysql_list_tables`       | Table names, approximate row counts, storage size, and engine from `information_schema`.            |
| `mysql_describe_table`    | Columns, primary key, indexes, and constraints for one validated table name.                        |
| `mysql_explain_query`     | The execution plan for a validated read-only `SELECT`, including scan/index use and estimated rows. |
| `mysql_find_slow_queries` | Bounded expensive-statement data from `performance_schema`, when enabled.                           |

Do not begin with a general arbitrary-query tool. It expands data exposure and requires rigorous SQL parsing, read-only enforcement, result limits, and sensitive-column handling. The five tools support an understandable demonstration: a lookup on an `orders` table is slow because `customer_id` has no index; the agent confirms that with schema and `EXPLAIN` evidence, then recommends an index.

## Elasticsearch / OpenSearch: a later option

Elasticsearch is useful when the product is about logs or search operations. Upstream HolmesGPT separates index-level read access from cluster-monitor access. Its data tools search documents, fetch mappings, and list indices; its cluster tools report health, allocation explanations, node statistics, index statistics, and `_cat` API results. [Elasticsearch/OpenSearch toolset](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/elasticsearch/)

Pick one direction if this becomes a later MVP:

| Direction         | Minimal tools                                                                     | Example question                                         |
| ----------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Log investigation | `list_indices`, `get_index_mapping`, `search_logs`, `get_document_count`          | “Why did checkout requests fail in the last 15 minutes?” |
| Cluster health    | `get_cluster_health`, `list_shards`, `explain_shard_allocation`, `get_node_stats` | “Why is the cluster yellow?”                             |

Do not combine both directions initially. The log-investigation route is usually more approachable for application developers. Cluster-health diagnostics need more infrastructure knowledge and a heavier local demonstration environment.

## Selection rule

Choose the system whose failures and diagnostic evidence you already understand.
The value of this port comes from an agent that selects tools, collects
evidence, and explains a real failure—not from reproducing every HolmesGPT
integration. Local Docker is the selected focused port; MySQL remains a
potential later extension.
