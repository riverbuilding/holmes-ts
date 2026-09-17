import type { DockerCommandResult, JsonObject, JsonValue, ToolError, ToolExecutionResult, ToolSuccess, Truncation } from "../core/types.js";

const SENSITIVE_LABEL_KEY = /secret|token|password|passwd|credential|auth|key/i;
const CONTROL_CHARACTER = /[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/;
const MAX_PROCESS_FIELDS = 32;

export class DockerProjectionError extends Error {
  public readonly name = "DockerProjectionError";
  public constructor() {
    super("Docker returned malformed output.");
  }
}

export function mapDockerCommandFailure(result: DockerCommandResult): ToolError | undefined {
  if (result.termination === "completed" && result.exitCode === 0) return undefined;
  if (result.termination === "timeout") return error("timeout", "Docker command timed out.", true);
  if (result.termination === "cancelled") return error("cancelled", "Docker command was cancelled.", false);
  if (result.termination === "spawn-error") return error("unavailable", "Docker is unavailable.", true);
  if (notFound(result.stderr)) return error("not-found", "Docker resource was not found.", false);
  if (stoppedContainer(result.stderr)) return error("nonzero-exit", "Docker container is not running.", false);
  if (unavailable(result.stderr)) return error("unavailable", "Docker is unavailable.", true);
  return error("nonzero-exit", "Docker command failed.", false);
}

export function parseJsonLines(output: string): JsonObject[] {
  const rows: JsonObject[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new DockerProjectionError();
    }
    if (!isObject(parsed)) throw new DockerProjectionError();
    rows.push(parsed);
  }
  return rows;
}

export function parseTable(output: string, headers: readonly string[]): JsonObject[] {
  if (headers.length === 0 || new Set(headers).size !== headers.length) throw new Error("headers must be non-empty and unique.");
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const parsedHeader = splitTableLine(lines[0]);
  if (parsedHeader.length !== headers.length || !parsedHeader.every((header, index) => header === headers[index])) throw new DockerProjectionError();
  return lines.slice(1).map((line) => {
    const values = splitTableLine(line);
    if (values.length !== headers.length) throw new DockerProjectionError();
    const row: JsonObject = {};
    for (let index = 0; index < headers.length; index += 1) row[headers[index]] = values[index];
    return row;
  });
}

export function parseSingleJsonObject(output: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new DockerProjectionError();
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isObject(parsed[0])) throw new DockerProjectionError();
  return parsed[0];
}

export function projectContainerRows(result: DockerCommandResult, collectedAt: string, maxRows: number): ToolExecutionResult {
  const failure = mapDockerCommandFailure(result);
  if (failure !== undefined) return failure;
  try {
    const rows = parseJsonLines(result.stdout).map(projectContainerRow).sort(compareContainerRows);
    const limited = limitRows(rows, maxRows);
    return success("docker-containers", { containers: limited.values }, collectedAt, limited.truncation ?? captureTruncation(result));
  } catch (error_) {
    return error_ instanceof DockerProjectionError
      ? error("malformed-output", "Docker returned malformed output.", false)
      : error("internal", "Docker result projection failed.", false);
  }
}

export function projectImageRows(result: DockerCommandResult, collectedAt: string, maxRows: number): ToolExecutionResult {
  const failure = mapDockerCommandFailure(result);
  if (failure !== undefined) return failure;
  try {
    const rows = parseJsonLines(result.stdout).map(projectImageRow).sort(compareImageRows);
    const limited = limitRows(rows, maxRows);
    return success("docker-images", { images: limited.values }, collectedAt, limited.truncation ?? captureTruncation(result));
  } catch (error_) {
    return projectionFailure(error_);
  }
}

export function projectProcessRows(result: DockerCommandResult, collectedAt: string, maxRows: number): ToolExecutionResult {
  const failure = mapDockerCommandFailure(result);
  if (failure !== undefined) return failure;
  try {
    const table = parseProcessTable(result.stdout);
    const rows = table.rows.sort(compareProcessRows);
    const limited = limitRows(rows, maxRows);
    return success("docker-top", { headers: table.headers, processes: limited.values }, collectedAt, limited.truncation ?? captureTruncation(result));
  } catch (error_) {
    return projectionFailure(error_);
  }
}

export function projectImageHistory(result: DockerCommandResult, collectedAt: string, maxRows: number): ToolExecutionResult {
  const failure = mapDockerCommandFailure(result);
  if (failure !== undefined) return failure;
  try {
    const rows = parseJsonLines(result.stdout).map(projectHistoryRow);
    const limited = limitRows(rows, maxRows);
    return success("docker-history", { history: limited.values }, collectedAt, limited.truncation ?? captureTruncation(result));
  } catch (error_) {
    return projectionFailure(error_);
  }
}

export function projectDiffRows(result: DockerCommandResult, collectedAt: string, maxRows: number): ToolExecutionResult {
  const failure = mapDockerCommandFailure(result);
  if (failure !== undefined) return failure;
  try {
    const rows = parseDiffLines(result.stdout).sort(compareDiffRows);
    const limited = limitRows(rows, maxRows);
    return success("docker-diff", { changes: limited.values }, collectedAt, limited.truncation ?? captureTruncation(result));
  } catch (error_) {
    return projectionFailure(error_);
  }
}

export function projectEvents(result: DockerCommandResult, collectedAt: string, maxRows: number): ToolExecutionResult {
  const failure = mapDockerCommandFailure(result);
  if (failure !== undefined) return failure;
  try {
    const rows = parseJsonLines(result.stdout).map(projectEvent).sort(compareEvents);
    const limited = limitRows(rows, maxRows);
    return success("docker-events", { events: limited.values }, collectedAt, limited.truncation ?? captureTruncation(result));
  } catch (error_) {
    return error_ instanceof DockerProjectionError
      ? error("malformed-output", "Docker returned malformed output.", false)
      : error("internal", "Docker result projection failed.", false);
  }
}

export function projectLogs(result: DockerCommandResult, collectedAt: string, maxLines: number): ToolExecutionResult {
  const failure = mapDockerCommandFailure(result);
  if (failure !== undefined) return failure;
  if (!Number.isSafeInteger(maxLines) || maxLines < 1) throw new Error("maxLines must be a positive integer.");
  const lines = result.stdout.split(/\r?\n/).filter((line, index, all) => line !== "" || index < all.length - 1);
  const limited = limitItems(lines, maxLines, "line-limit");
  return success("docker-logs", { lines: limited.values }, collectedAt, limited.truncation ?? captureTruncation(result));
}

export function projectInspect(result: DockerCommandResult, collectedAt: string): ToolExecutionResult {
  const failure = mapDockerCommandFailure(result);
  if (failure !== undefined) return failure;
  try {
    const document = parseSingleJsonObject(result.stdout);
    const projection = isObject(document.State) ? projectContainerInspect(document) : projectImageInspect(document);
    if (projection === undefined) throw new DockerProjectionError();
    return success("docker-inspect", projection, collectedAt, captureTruncation(result));
  } catch (error_) {
    return error_ instanceof DockerProjectionError
      ? error("malformed-output", "Docker returned malformed output.", false)
      : error("internal", "Docker result projection failed.", false);
  }
}

function projectContainerRow(row: JsonObject): JsonObject {
  const id = stringAt(row, "ID", "Id");
  if (id === undefined) throw new DockerProjectionError();
  return compact({
    id,
    name: stringAt(row, "Names", "Name"),
    image: stringAt(row, "Image"),
    command: stringAt(row, "Command"),
    createdAt: stringAt(row, "CreatedAt"),
    status: stringAt(row, "Status"),
    state: stringAt(row, "State"),
    health: stringAt(row, "Health"),
    labels: safeLabels(row.Labels)
  });
}

function projectImageRow(row: JsonObject): JsonObject {
  const repository = requiredString(row, "Repository");
  const tag = requiredString(row, "Tag");
  const id = requiredString(row, "ID");
  const createdAt = requiredString(row, "CreatedAt");
  const createdSince = requiredString(row, "CreatedSince");
  const size = requiredString(row, "Size");
  const dangling = repository === "<none>" || tag === "<none>";
  return compact({
    id,
    repository: repository === "<none>" ? undefined : repository,
    tag: tag === "<none>" ? undefined : tag,
    createdAt,
    createdSince,
    size,
    dangling
  });
}

function projectHistoryRow(row: JsonObject): JsonObject {
  return {
    id: requiredString(row, "ID"),
    createdAt: requiredString(row, "CreatedAt"),
    createdSince: requiredString(row, "CreatedSince"),
    size: requiredString(row, "Size"),
    comment: requiredString(row, "Comment", true),
    commandKind: historyCommandKind(requiredString(row, "CreatedBy", true))
  };
}

function projectEvent(row: JsonObject): JsonObject {
  const actor = objectAt(row, "Actor");
  const type = stringAt(row, "Type", "type");
  const action = stringAt(row, "Action", "action", "status");
  const resourceId = actor === undefined ? undefined : stringAt(actor, "ID");
  if (type === undefined || action === undefined || resourceId === undefined) throw new DockerProjectionError();
  return compact({
    time: stringAt(row, "time", "Time"),
    timeNano: numberAt(row, "timeNano", "TimeNano"),
    type,
    action,
    resourceId,
    resourceName: actor === undefined ? undefined : stringAt(objectAt(actor, "Attributes"), "name"),
    image: actor === undefined ? undefined : stringAt(objectAt(actor, "Attributes"), "image")
  });
}

function projectContainerInspect(document: JsonObject): JsonObject | undefined {
  const state = objectAt(document, "State");
  const id = stringAt(document, "Id");
  if (state === undefined || id === undefined) return undefined;
  const config = objectAt(document, "Config");
  const hostConfig = objectAt(document, "HostConfig");
  const restartPolicy = objectAt(hostConfig, "RestartPolicy");
  return compact({
    kind: "container",
    id,
    name: stringAt(document, "Name"),
    image: stringAt(document, "Image"),
    imageReference: stringAt(config, "Image"),
    createdAt: stringAt(document, "Created"),
    state: stringAt(state, "Status"),
    health: stringAt(objectAt(state, "Health"), "Status"),
    exitCode: numberAt(state, "ExitCode"),
    startedAt: stringAt(state, "StartedAt"),
    finishedAt: stringAt(state, "FinishedAt"),
    restartPolicy: stringAt(restartPolicy, "Name"),
    command: commandShape(config),
    labels: safeLabels(config?.Labels),
    mounts: mountSummary(document.Mounts),
    networks: networkSummary(objectAt(objectAt(document, "NetworkSettings"), "Networks"))
  });
}

function projectImageInspect(document: JsonObject): JsonObject | undefined {
  if (stringAt(document, "Id") === undefined || (stringAt(document, "Architecture") === undefined && stringAt(document, "Os") === undefined)) return undefined;
  const config = objectAt(document, "Config");
  return compact({
    kind: "image",
    id: stringAt(document, "Id"),
    tags: stringsAt(document, "RepoTags"),
    createdAt: stringAt(document, "Created"),
    architecture: stringAt(document, "Architecture"),
    os: stringAt(document, "Os"),
    entrypoint: stringsAt(config, "Entrypoint"),
    command: stringsAt(config, "Cmd"),
    labels: safeLabels(config?.Labels)
  });
}

function commandShape(config: JsonObject | undefined): JsonValue | undefined {
  const entrypoint = stringsAt(config, "Entrypoint");
  const command = stringsAt(config, "Cmd");
  if (entrypoint === undefined && command === undefined) return undefined;
  return compact({ entrypoint, command });
}

function mountSummary(value: JsonValue | undefined): JsonValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isObject).map((mount) => {
    const writable = booleanAt(mount, "RW");
    return compact({ type: stringAt(mount, "Type"), destination: stringAt(mount, "Destination"), readOnly: writable === undefined ? undefined : !writable });
  });
}

function networkSummary(networks: JsonObject | undefined): JsonObject | undefined {
  if (networks === undefined) return undefined;
  const names = Object.keys(networks).sort();
  return names.length === 0 ? undefined : { names };
}

function safeLabels(value: JsonValue | undefined): JsonObject | undefined {
  if (!isObject(value)) return undefined;
  const labels: JsonObject = {};
  for (const key of Object.keys(value).sort()) {
    const labelValue = value[key];
    if (typeof labelValue !== "string") continue;
    labels[key] = SENSITIVE_LABEL_KEY.test(key) ? "<withheld>" : labelValue;
  }
  return Object.keys(labels).length === 0 ? undefined : labels;
}

export function parseProcessTable(output: string): { headers: string[]; rows: JsonObject[] } {
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new DockerProjectionError();
  if (lines.some((line) => line === "" || CONTROL_CHARACTER.test(line))) throw new DockerProjectionError();
  const headers = splitTableLine(lines[0]);
  if (
    headers.length === 0 ||
    headers.length > MAX_PROCESS_FIELDS ||
    headers.some((header) => header === "" || CONTROL_CHARACTER.test(header)) ||
    new Set(headers).size !== headers.length
  )
    throw new DockerProjectionError();
  const rows = lines.slice(1).map((line) => {
    const fields = splitTableLine(line);
    if (fields.length !== headers.length || fields.some((field) => field === "" || CONTROL_CHARACTER.test(field))) throw new DockerProjectionError();
    return { fields };
  });
  return { headers, rows };
}

export function parseDiffLines(output: string): JsonObject[] {
  const lines = output.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) return [];
  return lines.map((line) => {
    const match = /^([ACD]) (.+)$/.exec(line);
    if (match === null || !match[2].startsWith("/") || CONTROL_CHARACTER.test(line)) throw new DockerProjectionError();
    const action = match[1] === "A" ? "added" : match[1] === "C" ? "changed" : "deleted";
    return { action, path: match[2] };
  });
}

function success(resource: string, attributes: JsonObject, collectedAt: string, truncation?: Truncation): ToolSuccess {
  return {
    status: "success",
    content: JSON.stringify(attributes),
    metadata: { resource, collectedAt, attributes },
    ...(truncation === undefined ? {} : { truncation })
  };
}

function limitRows<T>(values: readonly T[], maximum: number): { values: T[]; truncation?: Truncation } {
  return limitItems(values, maximum, "row-limit");
}

function projectionFailure(error_: unknown): ToolError {
  return error_ instanceof DockerProjectionError
    ? error("malformed-output", "Docker returned malformed output.", false)
    : error("internal", "Docker result projection failed.", false);
}

function limitItems<T>(values: readonly T[], maximum: number, reason: "row-limit" | "line-limit"): { values: T[]; truncation?: Truncation } {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("maximum must be a positive integer.");
  if (values.length <= maximum) return { values: [...values] };
  return { values: values.slice(0, maximum), truncation: { truncated: true, reason, originalItemCount: values.length, retainedItemCount: maximum } };
}

function captureTruncation(result: DockerCommandResult): Truncation | undefined {
  return result.outputTruncated ? { truncated: true, reason: "character-limit" } : undefined;
}

function error(code: ToolError["code"], message: string, retryable: boolean): ToolError {
  return { status: "error", code, message, retryable };
}
function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function objectAt(value: JsonObject | undefined, key: string): JsonObject | undefined {
  const item = value?.[key];
  return isObject(item) ? item : undefined;
}
function stringAt(value: JsonObject | undefined, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const item = value?.[key];
    if (typeof item === "string") return item;
  }
  return undefined;
}
function numberAt(value: JsonObject | undefined, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const item = value?.[key];
    if (typeof item === "number" && Number.isFinite(item)) return item;
  }
  return undefined;
}
function booleanAt(value: JsonObject | undefined, key: string): boolean | undefined {
  const item = value?.[key];
  return typeof item === "boolean" ? item : undefined;
}
function stringsAt(value: JsonObject | undefined, key: string): string[] | undefined {
  const item = value?.[key];
  return Array.isArray(item) && item.every((entry) => typeof entry === "string") ? [...item] : undefined;
}
function compact(value: Record<string, JsonValue | undefined>): JsonObject {
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) if (item !== undefined) result[key] = item;
  return result;
}
function requiredString(row: JsonObject, key: string, allowEmpty = false): string {
  const value = row[key];
  if (typeof value !== "string" || CONTROL_CHARACTER.test(value) || (!allowEmpty && value.trim() === "")) throw new DockerProjectionError();
  return value;
}
function historyCommandKind(createdBy: string): string {
  const command = createdBy
    .replace(/^\/bin\/sh -c\s+(?:#\(nop\)\s+)?/i, "")
    .trim()
    .toLowerCase();
  if (command.startsWith("run ")) return "run";
  if (command.startsWith("copy ") || command.startsWith("add ")) return "copy";
  if (command.startsWith("entrypoint ")) return "entrypoint";
  if (command.startsWith("cmd ")) return "cmd";
  return "other";
}
function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
function compareContainerRows(left: JsonObject, right: JsonObject): number {
  return String(left.name ?? left.id ?? "").localeCompare(String(right.name ?? right.id ?? ""));
}
function compareEvents(left: JsonObject, right: JsonObject): number {
  return `${left.timeNano ?? ""}:${left.resourceId ?? ""}`.localeCompare(`${right.timeNano ?? ""}:${right.resourceId ?? ""}`);
}
function compareImageRows(left: JsonObject, right: JsonObject): number {
  return (
    compareStrings(String(left.repository ?? ""), String(right.repository ?? "")) ||
    compareStrings(String(left.tag ?? ""), String(right.tag ?? "")) ||
    compareStrings(String(left.id), String(right.id))
  );
}
function compareProcessRows(left: JsonObject, right: JsonObject): number {
  return compareStrings(JSON.stringify(left.fields), JSON.stringify(right.fields));
}
function compareDiffRows(left: JsonObject, right: JsonObject): number {
  return compareStrings(String(left.path), String(right.path)) || compareStrings(String(left.action), String(right.action));
}
function notFound(stderr: string): boolean {
  return /no such (container|object|image)|not found/i.test(stderr);
}
function stoppedContainer(stderr: string): boolean {
  return /container .+ is not running|container is not running/i.test(stderr);
}
function unavailable(stderr: string): boolean {
  return /cannot connect to the docker daemon|failed to connect to the docker api|is the docker daemon running|connection refused|error during connect/i.test(
    stderr
  );
}
function splitTableLine(line: string): string[] {
  return line.trim().split(/(?:\t+| {2,})/);
}
