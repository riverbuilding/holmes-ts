import { spawn } from "node:child_process";
import type { DockerCommandResult } from "../core/types.js";

const DEFAULT_MAX_CAPTURE_BYTES = 1024 * 1024; // 1 MiB;
const DEFAULT_TERMINATION_GRACE_MS = 1_000;

/** A closed set of Docker reads. Application code never supplies argv. */
export type DockerCliOperation =
  | { readonly kind: "context-show" }
  | { readonly kind: "context-inspect"; readonly context: string }
  | { readonly kind: "container-ls"; readonly all: boolean }
  | { readonly kind: "image-ls" }
  | { readonly kind: "container-top"; readonly container: string }
  | { readonly kind: "image-history"; readonly image: string }
  | { readonly kind: "container-diff"; readonly container: string }
  | { readonly kind: "inspect"; readonly resource: string }
  | { readonly kind: "container-logs"; readonly container: string; readonly tail: number }
  | { readonly kind: "events"; readonly since: string; readonly until: string; readonly container?: string };

export interface DockerProcessLaunchOptions {
  readonly shell: false;
  readonly windowsHide: true;
  readonly stdio: readonly ["ignore", "pipe", "pipe"];
}

export interface DockerReadable {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown;
  off(event: "data", listener: (chunk: Buffer | string) => void): unknown;
}

/** Minimal child-process shape, so tests need no real executable or shell. */
export interface DockerSpawnedProcess {
  readonly stdout: DockerReadable;
  readonly stderr: DockerReadable;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  off(event: "error", listener: (error: Error) => void): unknown;
  off(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}

export type DockerProcessLauncher = (executable: string, arguments_: readonly string[], options: DockerProcessLaunchOptions) => DockerSpawnedProcess;

export interface DockerCliTimers {
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
}

export interface DockerCliOptions {
  /** Injectable only for tests; CLI configuration must never set this. */
  readonly executable?: string;
  readonly launcher?: DockerProcessLauncher;
  readonly now?: () => number;
  readonly timers?: DockerCliTimers;
  readonly maxCaptureBytes?: number;
  readonly terminationGraceMs?: number;
}

/** A startup-selected context that may safely be used in fixed command argv. */
export type DockerContext = string & { readonly __dockerContext: unique symbol };

/** A deliberately small, user-displayable startup error. */
export class DockerContextError extends Error {
  public readonly name = "DockerContextError";
}

/**
 * Executes only a fixed Docker operation through spawn-style argv execution.
 * It owns process lifecycle only; parsing and Docker error classification stay
 * in the tool/projection layer.
 */
export class DockerCli {
  private readonly executable: string;
  private readonly launcher: DockerProcessLauncher;
  private readonly now: () => number;
  private readonly timers: DockerCliTimers;
  private readonly maxCaptureBytes: number;
  private readonly terminationGraceMs: number;

  public constructor(options: DockerCliOptions = {}) {
    this.executable = options.executable ?? "docker";
    this.launcher = options.launcher ?? nodeLauncher;
    this.now = options.now ?? Date.now;
    this.timers = options.timers ?? { setTimeout, clearTimeout };
    this.maxCaptureBytes = positiveInteger(options.maxCaptureBytes, DEFAULT_MAX_CAPTURE_BYTES, "maxCaptureBytes");
    this.terminationGraceMs = positiveInteger(options.terminationGraceMs, DEFAULT_TERMINATION_GRACE_MS, "terminationGraceMs");
  }

  public execute(operation: DockerCliOperation, pinnedContext: string | undefined, signal: AbortSignal, timeoutMs: number): Promise<DockerCommandResult> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("timeoutMs must be a positive integer.");
    if (signal.aborted) return Promise.resolve(emptyResult("cancelled", this.now()));

    const startedAt = this.now();
    let child: DockerSpawnedProcess;
    try {
      child = this.launcher(this.executable, commandArguments(operation, pinnedContext), {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch {
      return Promise.resolve(emptyResult("spawn-error", startedAt, this.now()));
    }

    return new Promise((resolve) => {
      const stdout = new BoundedOutput(this.maxCaptureBytes);
      const stderr = new BoundedOutput(this.maxCaptureBytes);
      let termination: DockerCommandResult["termination"] | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      let settled = false;

      const finish = (exitCode: number | null, exitSignal: NodeJS.Signals | null = null): void => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) this.timers.clearTimeout(timeout);
        if (escalation !== undefined) this.timers.clearTimeout(escalation);
        signal.removeEventListener("abort", onAbort);
        child.stdout.off("data", onStdout);
        child.stderr.off("data", onStderr);
        child.off("error", onError);
        child.off("close", onClose);
        resolve({
          stdout: stdout.text(),
          stderr: stderr.text(),
          exitCode,
          durationMs: Math.max(0, this.now() - startedAt),
          termination: termination ?? (exitCode === 0 && exitSignal === null ? "completed" : "nonzero-exit"),
          outputTruncated: stdout.truncated || stderr.truncated
        });
      };

      const requestTermination = (reason: "timeout" | "cancelled"): void => {
        if (termination !== undefined || settled) return;
        termination = reason;
        safelyKill(child, "SIGTERM");
        escalation = this.timers.setTimeout(() => {
          if (!settled) safelyKill(child, "SIGKILL");
        }, this.terminationGraceMs);
      };
      const onAbort = (): void => requestTermination("cancelled");
      const onStdout = (chunk: Buffer | string): void => stdout.append(chunk);
      const onStderr = (chunk: Buffer | string): void => stderr.append(chunk);
      const onError = (): void => {
        termination = "spawn-error";
        finish(null);
      };
      const onClose = (exitCode: number | null, exitSignal: NodeJS.Signals | null): void => finish(exitCode, exitSignal);

      child.stdout.on("data", onStdout);
      child.stderr.on("data", onStderr);
      child.once("error", onError);
      child.once("close", onClose);
      signal.addEventListener("abort", onAbort, { once: true });
      timeout = this.timers.setTimeout(() => requestTermination("timeout"), timeoutMs);

      // A caller can abort between the initial check and listener registration.
      if (signal.aborted) onAbort();
    });
  }

  /**
   * Resolves the context exactly once at startup. The output of these probe
   * commands is intentionally consumed here and never becomes tool evidence.
   */
  public async resolveContext(explicitContext: string | undefined, signal: AbortSignal, timeoutMs: number): Promise<DockerContext> {
    const requested = explicitContext === undefined ? undefined : validateContextName(explicitContext);
    const operation: DockerCliOperation = requested === undefined ? { kind: "context-show" } : { kind: "context-inspect", context: requested };
    const result = await this.execute(operation, undefined, signal, timeoutMs);
    if (result.termination === "cancelled") throw new DockerContextError("Docker context resolution was cancelled.");
    if (result.termination === "timeout") throw new DockerContextError("Docker context resolution timed out.");
    if (result.termination !== "completed" || result.exitCode !== 0) {
      throw new DockerContextError("Docker context could not be resolved.");
    }
    if (requested !== undefined) return requested;
    try {
      return validateContextName(result.stdout.trim());
    } catch {
      throw new DockerContextError("Docker returned an invalid current context.");
    }
  }
}

/** Reject values that could change Docker's command-line interpretation. */
export function validateContextName(value: string): DockerContext {
  if (value.trim() !== value || value.length === 0 || value.startsWith("-") || /[\0\r\n\t ]/.test(value)) {
    throw new DockerContextError("Docker context must be a non-blank name and must not start with '-'.");
  }
  return value as DockerContext;
}

function commandArguments(operation: DockerCliOperation, pinnedContext: string | undefined): string[] {
  switch (operation.kind) {
    case "context-show":
      return ["context", "show"];
    case "context-inspect":
      return ["context", "inspect", operation.context];
    case "container-ls":
      return withContext(pinnedContext, ["container", "ls", ...(operation.all ? ["--all"] : []), "--format", "{{json .}}"]);
    case "image-ls":
      return withContext(pinnedContext, ["image", "ls", "--format", "{{json .}}"]);
    case "container-top":
      return withContext(pinnedContext, ["container", "top", operation.container]);
    case "image-history":
      return withContext(pinnedContext, ["image", "history", "--format", "{{json .}}", operation.image]);
    case "container-diff":
      return withContext(pinnedContext, ["container", "diff", operation.container]);
    case "inspect":
      return withContext(pinnedContext, ["inspect", operation.resource]);
    case "container-logs":
      return withContext(pinnedContext, ["container", "logs", "--timestamps", "--tail", String(operation.tail), operation.container]);
    case "events":
      return withContext(pinnedContext, [
        "events",
        "--since",
        operation.since,
        "--until",
        operation.until,
        "--format",
        "{{json .}}",
        ...(operation.container === undefined ? [] : ["--filter", `container=${operation.container}`])
      ]);
  }
}

function withContext(context: string | undefined, operation: string[]): string[] {
  if (context === undefined) throw new Error("A pinned Docker context is required for operational commands.");
  return ["--context", context, ...operation];
}

function nodeLauncher(executable: string, arguments_: readonly string[], options: DockerProcessLaunchOptions): DockerSpawnedProcess {
  const child = spawn(executable, [...arguments_], {
    shell: options.shell,
    windowsHide: options.windowsHide,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (!child.stdout || !child.stderr) throw new Error("Docker process did not provide output streams.");
  return child as unknown as DockerSpawnedProcess;
}

function emptyResult(termination: DockerCommandResult["termination"], startedAt: number, endedAt = startedAt): DockerCommandResult {
  return { stdout: "", stderr: "", exitCode: null, durationMs: Math.max(0, endedAt - startedAt), termination, outputTruncated: false };
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1) throw new Error(`${name} must be a positive integer.`);
  return resolved;
}

/** A race with a naturally exiting child must not escape as a Node error. */
function safelyKill(child: DockerSpawnedProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    /* close/error handlers determine the neutral result. */
  }
}

class BoundedOutput {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  public truncated = false;

  public constructor(private readonly maximum: number) {}

  public append(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = this.maximum - this.size;
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    if (bytes.byteLength > remaining) {
      this.chunks.push(bytes.subarray(0, remaining));
      this.size += remaining;
      this.truncated = true;
      return;
    }
    this.chunks.push(bytes);
    this.size += bytes.byteLength;
  }

  public text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}
