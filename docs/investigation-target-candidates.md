# MVP investigation-target candidates

Date: September 8, 2026  
Decision: Docker diagnostics is the first TypeScript MVP target. MySQL is the preferred next target; Elasticsearch is deferred.

HolmesGPT’s investigation engine is not tied to Kubernetes. It gives an LLM a small set of read-only tools, feeds tool results back into the conversation, and asks it to form an evidence-backed diagnosis. The tool implementation determines what is being investigated.

## Candidate comparison

| Candidate | Questions the MVP can answer | Setup and domain complexity | Recommendation |
|---|---|---|---|
| Docker | Why did a container exit? What does its startup log say? What changed? | Low; works on a developer laptop with Docker. | First MVP. |
| MySQL | Why is an order lookup slow? Which index is missing? Which query is expensive? | Medium; requires a sample schema and knowledge of SQL/execution plans. | Best second target for backend/database experience. |
| Elasticsearch / OpenSearch | Why did requests fail? Which log events occurred? Why are shards unassigned? | Medium-high; requires index, mapping, Query DSL, and cluster concepts. | Defer unless search/log observability is already familiar. |

## Docker: selected MVP

Docker is the smallest useful implementation because each diagnostic operation maps directly to a local Docker CLI command and a typical failure is easy to reproduce. Upstream HolmesGPT exposes read-only Docker operations for listing images and containers, inspecting a container or image, reading logs, listing processes, reading events, viewing image history, and inspecting filesystem changes. [Docker toolset](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/docker/)

The initial port uses only four tools:

| Tool | Read-only operation | MVP use |
|---|---|---|
| `list_containers` | `docker ps -a` with a fixed output format | Discover the affected stopped or running container. |
| `inspect_container` | `docker inspect <validated-container-id-or-name>` with projected fields | Read state, exit code, image, command, health, and selected environment-variable names. |
| `get_container_logs` | `docker logs --tail <bounded-count> <validated-container-id-or-name>` | Collect startup/error evidence. |
| `get_container_events` | `docker events` with a fixed, bounded time window and container filter | Explain starts, stops, kills, health-status changes, and restarts. |

The tool registry will construct argument arrays without a shell. It will reject unknown flags and invalid container identifiers, set subprocess timeouts, bound output, and never expose `docker exec`, `docker run`, `docker rm`, `docker stop`, `docker restart`, `docker build`, or any write operation.

The primary demonstration asks, “Why did the checkout container exit?” A disposable TypeScript service exits when `APP_MODE` is absent. The agent lists containers, inspects the exited one, reads the log that reports the missing variable, and cites both observations. A secondary demonstration uses an unavailable image tag. A third scenario with inaccessible logs verifies that the agent reports uncertainty rather than inventing a root cause.

## MySQL: recommended next target

MySQL is the best follow-up if the project owner is comfortable with backend applications and SQL. HolmesGPT’s MySQL integration supports query-performance analysis, slow-query investigation, index analysis, health inspection, and troubleshooting reads. It defaults to read-only SQL and allows `SELECT`, `SHOW`, `DESCRIBE`, `EXPLAIN`, and `WITH` statements. [MySQL toolset](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/database-mysql/)

An appropriate MySQL MVP would expose five constrained tools:

| Tool | Evidence returned |
|---|---|
| `mysql_server_info` | Connectivity, version, uptime, and selected server status counters. |
| `mysql_list_tables` | Table names, approximate row counts, storage size, and engine from `information_schema`. |
| `mysql_describe_table` | Columns, primary key, indexes, and constraints for one validated table name. |
| `mysql_explain_query` | The execution plan for a validated read-only `SELECT`, including scan/index use and estimated rows. |
| `mysql_find_slow_queries` | Bounded expensive-statement data from `performance_schema`, when enabled. |

Do not begin with a general arbitrary-query tool. It expands data exposure and requires rigorous SQL parsing, read-only enforcement, result limits, and sensitive-column handling. The five tools support an understandable demonstration: a lookup on an `orders` table is slow because `customer_id` has no index; the agent confirms that with schema and `EXPLAIN` evidence, then recommends an index.

## Elasticsearch / OpenSearch: a later option

Elasticsearch is useful when the product is about logs or search operations. Upstream HolmesGPT separates index-level read access from cluster-monitor access. Its data tools search documents, fetch mappings, and list indices; its cluster tools report health, allocation explanations, node statistics, index statistics, and `_cat` API results. [Elasticsearch/OpenSearch toolset](https://holmesgpt.dev/latest/data-sources/builtin-toolsets/elasticsearch/)

Pick one direction if this becomes a later MVP:

| Direction | Minimal tools | Example question |
|---|---|---|
| Log investigation | `list_indices`, `get_index_mapping`, `search_logs`, `get_document_count` | “Why did checkout requests fail in the last 15 minutes?” |
| Cluster health | `get_cluster_health`, `list_shards`, `explain_shard_allocation`, `get_node_stats` | “Why is the cluster yellow?” |

Do not combine both directions initially. The log-investigation route is usually more approachable for application developers. Cluster-health diagnostics need more infrastructure knowledge and a heavier local demonstration environment.

## Selection rule

Choose the system whose failures and diagnostic evidence you already understand. The value of this port comes from demonstrating an agent that selects tools, collects evidence, and explains a real failure—not from reproducing every HolmesGPT integration. Docker now provides that smallest complete learning path; MySQL is the next natural extension.
