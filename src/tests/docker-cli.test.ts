import assert from "node:assert/strict";
import test from "node:test";
import { DockerCli, DockerContextError, type DockerCliTimers, type DockerProcessLaunchOptions, type DockerSpawnedProcess } from "../tools/docker-cli.js";

test("context resolution probes exactly once and rejects unsafe explicit names before launch", async () => {
  const launcher = new FakeLauncher();
  const cli = new DockerCli({ launcher: launcher.launch });
  const resolved = cli.resolveContext("team-dev", new AbortController().signal, 100);
  requiredProcess(launcher).close(0);
  assert.equal(await resolved, "team-dev");
  assert.deepEqual(launcher.calls[0]?.arguments_, ["context", "inspect", "team-dev"]);

  await assert.rejects(
    cli.resolveContext("--host=tcp://elsewhere", new AbortController().signal, 100),
    DockerContextError
  );
  assert.equal(launcher.calls.length, 1);
});

test("default context is read once and normalized before it can be pinned", async () => {
  const launcher = new FakeLauncher();
  const cli = new DockerCli({ launcher: launcher.launch });
  const resolved = cli.resolveContext(undefined, new AbortController().signal, 100);
  requiredProcess(launcher).stdout.emit("desktop-linux\n");
  requiredProcess(launcher).close(0);
  assert.equal(await resolved, "desktop-linux");
  assert.deepEqual(launcher.calls[0]?.arguments_, ["context", "show"]);
});

test("Docker CLI invokes only the injected executable with a fixed argv array and never a shell", async () => {
  const launcher = new FakeLauncher();
  const cli = new DockerCli({ executable: "/test/docker", launcher: launcher.launch });

  const pending = cli.execute(
    { kind: "container-logs", container: "api; rm -rf /", tail: 7 },
    "team-dev",
    new AbortController().signal,
    100
  );
  launcher.processes[0]?.close(0);
  await pending;

  assert.deepEqual(launcher.calls, [{
    executable: "/test/docker",
    arguments_: ["--context", "team-dev", "container", "logs", "--timestamps", "--tail", "7", "api; rm -rf /"],
    options: { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
  }]);
  assert.equal(launcher.calls[0]?.arguments_.includes("/bin/sh"), false);
  assert.equal(launcher.calls[0]?.arguments_.includes("exec"), false);
});

test("container discovery has fixed JSON output formatting and an optional fixed all flag", async () => {
  const launcher = new FakeLauncher();
  const cli = new DockerCli({ launcher: launcher.launch });
  const running = cli.execute({ kind: "container-ls", all: false }, "team-dev", new AbortController().signal, 100);
  requiredProcess(launcher).close(0);
  const runningResult = await running;
  const all = cli.execute({ kind: "container-ls", all: true }, "team-dev", new AbortController().signal, 100);
  requiredProcess(launcher).close(0);
  const allResult = await all;

  assert.equal(runningResult.termination, "completed");
  assert.equal(allResult.termination, "completed");
  assert.deepEqual(launcher.calls.map((call) => call.arguments_), [
    ["--context", "team-dev", "container", "ls", "--format", "{{json .}}"],
    ["--context", "team-dev", "container", "ls", "--all", "--format", "{{json .}}"]
  ]);
});

test("an already-aborted caller starts no process", async () => {
  const launcher = new FakeLauncher();
  const caller = new AbortController();
  caller.abort();

  const result = await new DockerCli({ launcher: launcher.launch }).execute(
    { kind: "context-show" }, undefined, caller.signal, 100
  );

  assert.equal(launcher.calls.length, 0);
  assert.deepEqual(result, {
    stdout: "", stderr: "", exitCode: null, durationMs: 0,
    termination: "cancelled", outputTruncated: false
  });
});

test("timeout sends TERM, waits for a late close, and leaves no timer or listener behind", async () => {
  const clock = new FakeClock();
  const launcher = new FakeLauncher();
  const cli = new DockerCli({ launcher: launcher.launch, now: clock.now, timers: clock, terminationGraceMs: 20 });

  const pending = cli.execute({ kind: "context-show" }, undefined, new AbortController().signal, 10);
  const process = requiredProcess(launcher);
  process.stdout.emit("partial output");
  clock.advance(10);
  assert.deepEqual(process.killSignals, ["SIGTERM"]);
  assert.equal(clock.pendingCount, 1, "only the post-TERM escalation remains");

  clock.advance(5);
  process.close(null, "SIGTERM");
  const result = await pending;
  assert.deepEqual(result, {
    stdout: "partial output", stderr: "", exitCode: null, durationMs: 15,
    termination: "timeout", outputTruncated: false
  });
  assert.equal(clock.pendingCount, 0);
  assert.equal(process.listenerCount, 0);
});

test("caller cancellation wins deterministically and escalation uses KILL only if the child has not drained", async () => {
  const clock = new FakeClock();
  const launcher = new FakeLauncher();
  const cli = new DockerCli({ launcher: launcher.launch, now: clock.now, timers: clock, terminationGraceMs: 5 });
  const caller = new AbortController();
  const pending = cli.execute({ kind: "context-show" }, undefined, caller.signal, 10);
  const process = requiredProcess(launcher);

  caller.abort();
  clock.advance(5);
  assert.deepEqual(process.killSignals, ["SIGTERM", "SIGKILL"]);
  process.close(null, "SIGKILL");
  const result = await pending;

  assert.equal(result.termination, "cancelled");
  assert.equal(clock.pendingCount, 0);
  assert.equal(process.listenerCount, 0);
});

test("nonzero exits and raw process errors become neutral results, never thrown errors", async () => {
  const launcher = new FakeLauncher();
  const cli = new DockerCli({ launcher: launcher.launch });
  const nonzero = cli.execute({ kind: "context-show" }, undefined, new AbortController().signal, 100);
  requiredProcess(launcher).stderr.emit("daemon refused connection");
  requiredProcess(launcher).close(125);
  const nonzeroResult = await nonzero;
  assert.equal(nonzeroResult.termination, "nonzero-exit");
  assert.equal(nonzeroResult.exitCode, 125);
  assert.equal(nonzeroResult.stderr, "daemon refused connection");

  const spawnFailure = cli.execute({ kind: "context-show" }, undefined, new AbortController().signal, 100);
  requiredProcess(launcher).error(new Error("credential=do-not-leak"));
  const failureResult = await spawnFailure;
  assert.deepEqual(failureResult, {
    stdout: "", stderr: "", exitCode: null, durationMs: 0,
    termination: "spawn-error", outputTruncated: false
  });
  assert.doesNotMatch(JSON.stringify(failureResult), /credential/);
});

class FakeLauncher {
  public readonly calls: Array<{ executable: string; arguments_: readonly string[]; options: DockerProcessLaunchOptions }> = [];
  public readonly processes: FakeProcess[] = [];
  public readonly launch = (executable: string, arguments_: readonly string[], options: DockerProcessLaunchOptions): DockerSpawnedProcess => {
    this.calls.push({ executable, arguments_, options });
    const process = new FakeProcess();
    this.processes.push(process);
    return process;
  };
}

class FakeProcess implements DockerSpawnedProcess {
  public readonly stdout = new FakeReadable();
  public readonly stderr = new FakeReadable();
  public readonly killSignals: NodeJS.Signals[] = [];
  private errorListener: ((error: Error) => void) | undefined;
  private closeListener: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined;

  public once(event: "error" | "close", listener: ((error: Error) => void) | ((code: number | null, signal: NodeJS.Signals | null) => void)): unknown {
    if (event === "error") this.errorListener = listener as (error: Error) => void;
    else this.closeListener = listener as (code: number | null, signal: NodeJS.Signals | null) => void;
    return undefined;
  }
  public off(event: "error" | "close", listener: ((error: Error) => void) | ((code: number | null, signal: NodeJS.Signals | null) => void)): unknown {
    if (event === "error" && this.errorListener === listener) this.errorListener = undefined;
    if (event === "close" && this.closeListener === listener) this.closeListener = undefined;
    return undefined;
  }
  public kill(signal: NodeJS.Signals = "SIGTERM"): boolean { this.killSignals.push(signal); return true; }
  public close(code: number | null, signal: NodeJS.Signals | null = null): void { this.closeListener?.(code, signal); }
  public error(error: Error): void { this.errorListener?.(error); }
  public get listenerCount(): number {
    return this.stdout.listenerCount + this.stderr.listenerCount + Number(this.errorListener !== undefined) + Number(this.closeListener !== undefined);
  }
}

class FakeReadable {
  private listener: ((chunk: Buffer | string) => void) | undefined;
  public on(_event: "data", listener: (chunk: Buffer | string) => void): unknown { this.listener = listener; return undefined; }
  public off(_event: "data", listener: (chunk: Buffer | string) => void): unknown { if (this.listener === listener) this.listener = undefined; return undefined; }
  public emit(chunk: Buffer | string): void { this.listener?.(chunk); }
  public get listenerCount(): number { return Number(this.listener !== undefined); }
}

class FakeClock implements DockerCliTimers {
  private current = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; callback: () => void }>();
  public readonly now = (): number => this.current;
  public get pendingCount(): number { return this.timers.size; }
  public setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    const id = this.nextId++;
    this.timers.set(id, { at: this.current + delayMs, callback });
    return id as unknown as ReturnType<typeof setTimeout>;
  }
  public clearTimeout(handle: ReturnType<typeof setTimeout>): void { this.timers.delete(handle as unknown as number); }
  public advance(milliseconds: number): void {
    const target = this.current + milliseconds;
    while (true) {
      const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort(([left], [right]) => left - right)[0];
      if (!due) break;
      this.current = due[1].at;
      this.timers.delete(due[0]);
      due[1].callback();
    }
    this.current = target;
  }
}

function requiredProcess(launcher: FakeLauncher): FakeProcess {
  const process = launcher.processes.at(-1);
  assert.ok(process, "expected Docker process launch");
  return process;
}
