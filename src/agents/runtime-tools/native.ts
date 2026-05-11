import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 30_000;

type RuntimeEnvelope =
  | {
      id?: unknown;
      ok: true;
      result: unknown;
    }
  | {
      id?: unknown;
      ok: false;
      code?: string;
      message?: string;
    };

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

function runtimeBinaryName(platform: NodeJS.Platform = process.platform): string {
  return platform === "win32" ? "crawclaw-runtime.exe" : "crawclaw-runtime";
}

function existingPath(paths: string[], existsSync: (path: string) => boolean = fs.existsSync) {
  return paths.find((candidate) => existsSync(candidate));
}

export function resolveCrawClawRuntimeArgv(
  params: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    platform?: NodeJS.Platform;
    existsSync?: (path: string) => boolean;
  } = {},
): string[] {
  const env = params.env ?? process.env;
  const cwd = params.cwd ?? process.cwd();
  const existsSync = params.existsSync ?? fs.existsSync;
  const explicit = env.CRAWCLAW_RUNTIME_BIN?.trim();
  if (explicit) {
    return [explicit];
  }

  const bin = runtimeBinaryName(params.platform);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidate = existingPath(
    [
      path.resolve(moduleDir, "..", "native", bin),
      path.resolve(cwd, "dist", "native", bin),
      path.resolve(cwd, "target", "debug", bin),
      path.resolve(cwd, "target", "release", bin),
    ],
    existsSync,
  );
  if (candidate) {
    return [candidate];
  }

  if (existsSync(path.resolve(cwd, "Cargo.toml"))) {
    return ["cargo", "run", "--quiet", "-p", "crawclaw-runtime", "--"];
  }

  return [bin];
}

export function resolveCrawClawRuntimeWorkerArgv(runtimeArgv: string[]): string[] {
  return [...runtimeArgv, "--worker"];
}

class CrawClawRuntimeWorker {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 0;
  private stderrTail = "";
  private closed = false;

  constructor(
    private readonly argv: string[],
    env?: NodeJS.ProcessEnv,
  ) {
    const [command, ...args] = resolveCrawClawRuntimeWorkerArgv(argv);
    this.child = spawn(command, args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      this.handleLine(line);
    });
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-4000);
    });
    this.child.on("error", (error) => {
      this.closeWithError(error);
    });
    this.child.on("exit", (code, signal) => {
      this.closeWithError(
        new Error(
          this.stderrTail.trim() ||
            `crawclaw runtime worker exited with code ${code ?? "null"} signal ${signal ?? "null"}`,
        ),
      );
    });
  }

  get isClosed() {
    return this.closed || this.child.killed;
  }

  request<T>(tool: string, input: unknown, timeoutMs: number): Promise<T> {
    if (this.isClosed || !this.child.stdin.writable) {
      throw new Error("crawclaw runtime worker is not running");
    }
    const id = `${Date.now()}-${++this.nextId}`;
    const payload = `${JSON.stringify({ id, tool, input: input ?? {} })}\n`;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`crawclaw runtime worker timed out running ${tool}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (result) => resolve(result as T),
        reject,
        timeout,
      });
      this.child.stdin.write(payload, (error) => {
        if (!error) {
          return;
        }
        const pending = this.pending.get(id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(id);
          pending.reject(error);
        }
      });
    });
  }

  shutdown() {
    this.closeWithError(new Error("crawclaw runtime worker shut down"));
    if (!this.child.killed) {
      this.child.kill();
    }
  }

  private handleLine(line: string) {
    let envelope: RuntimeEnvelope;
    try {
      envelope = JSON.parse(line) as RuntimeEnvelope;
    } catch {
      return;
    }
    const id = envelopeId(envelope.id);
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pending.delete(id);
    if (envelope.ok) {
      pending.resolve(envelope.result);
      return;
    }
    const code = envelope.code ? `${envelope.code}: ` : "";
    pending.reject(new Error(`${code}${envelope.message ?? "crawclaw runtime tool failed"}`));
  }

  private closeWithError(error: Error) {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

const runtimeWorkers = new Map<string, CrawClawRuntimeWorker>();

function runtimeWorkerKey(runtimeArgv: string[], env?: NodeJS.ProcessEnv) {
  return JSON.stringify({
    argv: runtimeArgv,
    bin: env?.CRAWCLAW_RUNTIME_BIN,
    spawnLog: env?.CRAWCLAW_RUNTIME_SPAWN_LOG,
  });
}

function envelopeId(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function getCrawClawRuntimeWorker(runtimeArgv: string[], env?: NodeJS.ProcessEnv) {
  const key = runtimeWorkerKey(runtimeArgv, env);
  const existing = runtimeWorkers.get(key);
  if (existing && !existing.isClosed) {
    return existing;
  }
  const worker = new CrawClawRuntimeWorker(runtimeArgv, env);
  runtimeWorkers.set(key, worker);
  return worker;
}

export function shutdownCrawClawRuntimeWorkersForTests() {
  for (const worker of runtimeWorkers.values()) {
    worker.shutdown();
  }
  runtimeWorkers.clear();
}

export async function runCrawClawRuntimeTool<T = unknown>(
  tool: string,
  input: unknown,
  options?: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
  },
): Promise<T> {
  const runtimeArgv = resolveCrawClawRuntimeArgv({ env: options?.env });
  return getCrawClawRuntimeWorker(runtimeArgv, options?.env).request<T>(
    tool,
    input,
    options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
}
