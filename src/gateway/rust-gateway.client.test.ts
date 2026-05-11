import { spawn, spawnSync, type ChildProcessByStdio } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayClient } from "./client.js";
import type { EventFrame, HelloOk } from "./protocol/index.js";

type RustGatewayChild = ChildProcessByStdio<null, Readable, Readable>;
type GatewayClientOptions = ConstructorParameters<typeof GatewayClient>[0];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const toolchainHome = resolveToolchainHome();
const children: RustGatewayChild[] = [];
const tempDirs: string[] = [];
let debugGatewayBuilt = false;

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild));
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});

describe("Rust Gateway bridge", () => {
  it("accepts the existing TS GatewayClient handshake and method calls", async () => {
    const port = await getFreePort();
    const child = spawnRustGateway(port);
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });

    await waitForHealth(port, () => stderr);

    const { client, hello: helloPromise } = startGatewayClient(port);
    try {
      const hello = await helloPromise;

      expect(hello.protocol).toBe(3);
      expect(hello.server.version).toBeTruthy();
      expect(hello.features.methods).toContain("health");
      expect(hello.features.methods).toEqual(
        expect.arrayContaining([
          "exec.approval.request",
          "plugin.approval.request",
          "workflow.list",
          "skills.status",
          "agent.identity.get",
        ]),
      );

      const health = await client.request<{ runtime?: string; status?: string }>("health", {});
      expect(health).toMatchObject({ runtime: "rust", status: "ok" });
    } finally {
      await client?.stopAndWait({ timeoutMs: 1_000 });
    }
  }, 30_000);

  it("serves config and session methods from the Rust runtime domains", async () => {
    const port = await getFreePort();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-rust-gateway-"));
    const runtimeRoot = createGitUpdateRoot();
    tempDirs.push(stateDir);
    const child = spawnRustGateway(port, {
      CRAWCLAW_SECRET_TEST: "sk-rust-secret",
      CRAWCLAW_STATE_DIR: stateDir,
      CRAWCLAW_RUNTIME_ROOT: runtimeRoot,
    });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });

    await waitForHealth(port, () => stderr);

    const events: EventFrame[] = [];
    const { client, hello: helloPromise } = startGatewayClient(port, {
      onEvent: (event) => {
        events.push(event);
      },
    });
    try {
      await helloPromise;

      const before = await client.request<{ exists?: boolean; path?: string }>("config.get", {});
      expect(before.exists).toBe(false);
      expect(before.path).toBe(path.join(stateDir, "crawclaw.json"));

      const patch = await client.request<{
        ok?: boolean;
        config?: { tools?: { deny?: string[] } };
      }>("config.patch", { raw: JSON.stringify({ tools: { deny: ["browser"] } }) });
      expect(patch.ok).toBe(true);
      expect(patch.config?.tools?.deny).toEqual(["browser"]);

      const after = await client.request<{
        exists?: boolean;
        config?: { tools?: { deny?: string[] } };
      }>("config.get", {});
      expect(after.exists).toBe(true);
      expect(after.config?.tools?.deny).toEqual(["browser"]);

      const schema = await client.request<{
        version?: string;
        schema?: { type?: string };
        uiHints?: Record<string, { label?: string }>;
      }>("config.schema", {});
      expect(schema.version).toBe("rust-baseline-v1");
      expect(schema.schema?.type).toBe("object");
      expect(schema.uiHints?.gateway?.label).toBeTruthy();

      const schemaLookup = await client.request<{
        path?: string;
        children?: Array<{ key?: string; path?: string }>;
      }>("config.schema.lookup", { path: "gateway" });
      expect(schemaLookup.path).toBe("gateway");
      expect(schemaLookup.children?.some((child) => child.path === "gateway.port")).toBe(true);

      const secretPatch = await client.request<{
        ok?: boolean;
        config?: { talk?: { apiKey?: { source?: string; id?: string } } };
      }>("config.patch", {
        raw: JSON.stringify({
          talk: { apiKey: { source: "env", id: "CRAWCLAW_SECRET_TEST" } },
        }),
      });
      expect(secretPatch.ok).toBe(true);
      expect(secretPatch.config?.talk?.apiKey?.source).toBe("env");

      const secretsReload = await client.request<{ ok?: boolean; warningCount?: number }>(
        "secrets.reload",
        {},
      );
      expect(secretsReload).toMatchObject({ ok: true, warningCount: 0 });

      const resolvedSecret = await client.request<{
        ok?: boolean;
        assignments?: Array<{ path?: string; pathSegments?: string[]; value?: unknown }>;
        inactiveRefPaths?: string[];
      }>("secrets.resolve", {
        commandName: "memory status",
        targetIds: ["talk.apiKey"],
      });
      expect(resolvedSecret.ok).toBe(true);
      expect(resolvedSecret.assignments?.[0]).toMatchObject({
        path: "talk.apiKey",
        pathSegments: ["talk", "apiKey"],
        value: "sk-rust-secret",
      });
      expect(resolvedSecret.inactiveRefPaths).toEqual([]);

      const toolsCatalog = await client.request<{
        agentId?: string;
        profiles?: Array<{ id?: string }>;
        groups?: Array<{ id?: string; tools?: Array<{ id?: string; source?: string }> }>;
      }>("tools.catalog", { agentId: "main" });
      expect(toolsCatalog.agentId).toBe("main");
      expect(toolsCatalog.profiles?.some((profile) => profile.id === "coding")).toBe(true);
      expect(toolsCatalog.groups?.[0]?.tools?.some((tool) => tool.id === "bash")).toBe(true);
      expect(toolsCatalog.groups?.[0]?.tools?.every((tool) => tool.source === "core")).toBe(true);

      const effectiveTools = await client.request<{
        profile?: string;
        groups?: Array<{ id?: string; tools?: Array<{ id?: string; rawDescription?: string }> }>;
      }>("tools.effective", { agentId: "main", sessionKey: "agent:main:main" });
      expect(effectiveTools.profile).toBe("coding");
      expect(effectiveTools.groups?.[0]?.id).toBe("core");
      expect(effectiveTools.groups?.[0]?.tools?.some((tool) => tool.id === "bash")).toBe(true);

      const models = await client.request<{
        models?: Array<{ id?: string; provider?: string; reasoning?: boolean }>;
      }>("models.list", {});
      expect(models.models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "gpt-5.4", provider: "openai", reasoning: true }),
        ]),
      );

      const agents = await client.request<{
        defaultId?: string;
        mainKey?: string;
        scope?: string;
        agents?: Array<{ id?: string; model?: { primary?: string } }>;
      }>("agents.list", {});
      expect(agents).toMatchObject({
        defaultId: "main",
        mainKey: "agent:main:main",
        scope: "global",
      });
      expect(agents.agents?.[0]?.id).toBe("main");

      const pluginEnable = await client.request<{ ok?: boolean; id?: string; enabled?: boolean }>(
        "plugins.enable",
        { id: "open-websearch" },
      );
      expect(pluginEnable).toMatchObject({ ok: true, id: "open-websearch", enabled: true });

      const plugins = await client.request<{
        plugins?: Array<{ id?: string; enabled?: boolean; source?: string }>;
      }>("plugins.list", {});
      expect(plugins.plugins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "open-websearch",
            enabled: true,
            source: "config",
          }),
        ]),
      );

      const channelPatch = await client.request<{
        ok?: boolean;
        channel?: string;
        config?: { enabled?: boolean };
      }>("channels.config.patch", {
        channel: "telegram",
        raw: JSON.stringify({ enabled: true }),
      });
      expect(channelPatch).toMatchObject({
        ok: true,
        channel: "telegram",
        config: { enabled: true },
      });

      const channels = await client.request<{
        channelOrder?: string[];
        channelAccounts?: Record<string, Array<{ accountId?: string; configured?: boolean }>>;
      }>("channels.status", { probe: false });
      expect(channels.channelOrder).toContain("telegram");
      expect(channels.channelAccounts?.telegram?.[0]).toMatchObject({
        accountId: "default",
        configured: true,
      });

      const channelSurface = await client.request<{
        channel?: string;
        configured?: boolean;
        mode?: string;
      }>("channels.setup.surface", { channel: "telegram" });
      expect(channelSurface).toMatchObject({
        channel: "telegram",
        configured: true,
        mode: "config",
      });

      const ttsEnable = await client.request<{ ok?: boolean; enabled?: boolean }>("tts.enable", {});
      expect(ttsEnable).toMatchObject({ ok: true, enabled: true });
      const ttsProvider = await client.request<{ ok?: boolean; provider?: string }>(
        "tts.setProvider",
        { provider: "qwen3-tts" },
      );
      expect(ttsProvider).toMatchObject({ ok: true, provider: "qwen3-tts" });
      const ttsStatus = await client.request<{ enabled?: boolean; provider?: string }>(
        "tts.status",
        {},
      );
      expect(ttsStatus).toMatchObject({ enabled: true, provider: "qwen3-tts" });

      const talkMode = await client.request<{ ok?: boolean; enabled?: boolean }>("talk.mode", {
        enabled: true,
      });
      expect(talkMode).toMatchObject({ ok: true, enabled: true });
      const talkConfig = await client.request<{ config?: { talk?: { enabled?: boolean } } }>(
        "talk.config",
        {},
      );
      expect(talkConfig.config?.talk?.enabled).toBe(true);

      const voicewakeSet = await client.request<{
        ok?: boolean;
        config?: { enabled?: boolean };
      }>("voicewake.set", {
        patch: { enabled: true },
      });
      expect(voicewakeSet).toMatchObject({ ok: true, config: { enabled: true } });
      const voicewake = await client.request<{ config?: { enabled?: boolean } }>(
        "voicewake.get",
        {},
      );
      expect(voicewake.config?.enabled).toBe(true);

      const usage = await client.request<{ updatedAt?: number; providers?: unknown[] }>(
        "usage.status",
        {},
      );
      expect(typeof usage.updatedAt).toBe("number");
      expect(Array.isArray(usage.providers)).toBe(true);
      for (const provider of usage.providers ?? []) {
        expect(provider).toMatchObject({
          displayName: expect.any(String),
          provider: expect.any(String),
          windows: expect.any(Array),
        });
      }

      const doctor = await client.request<{ ok?: boolean; implementation?: string }>(
        "doctor.memory.status",
        {},
      );
      expect(doctor).toMatchObject({ ok: true, implementation: "rust-native" });

      const runtimeSummary = await client.request<{ running?: number; failed?: number }>(
        "agentRuntime.summary",
        {},
      );
      expect(runtimeSummary).toMatchObject({ running: 0, failed: 0 });

      const runtimeList = await client.request<{ count?: number; runs?: unknown[] }>(
        "agentRuntime.list",
        {},
      );
      expect(runtimeList).toMatchObject({ count: 0, runs: [] });

      const update = await client.request<{
        ok?: boolean;
        status?: string;
        result?: { status?: string; mode?: string; reason?: string };
      }>("update.run", {});
      expect(update).toMatchObject({
        ok: true,
        status: "skipped",
        result: { status: "skipped", mode: "git", reason: "no-upstream" },
      });

      const identity = await client.request<{ deviceId?: string; publicKey?: string }>(
        "gateway.identity.get",
        {},
      );
      expect(identity.deviceId).toMatch(/^[a-f0-9]{64}$/);
      expect(identity.publicKey).toBeTruthy();
      expect(fs.existsSync(path.join(stateDir, "identity", "device.json"))).toBe(true);

      const noWake = await client.request<null>("system.mainSessionWake.last", {});
      expect(noWake).toBeNull();

      const created = await client.request<{
        key?: string;
        sessionId?: string;
        runStarted?: boolean;
        entry?: { sessionFile?: string; label?: string };
      }>("sessions.create", { key: "main", label: "Rust Main" });
      expect(created.key).toBe("agent:main:main");
      expect(created.sessionId).toBeTruthy();
      expect(created.runStarted).toBe(false);
      expect(created.entry?.label).toBe("Rust Main");
      expect(created.entry?.sessionFile).toBeTruthy();

      const list = await client.request<{
        count?: number;
        sessions?: Array<{ key?: string; label?: string }>;
      }>("sessions.list", {});
      expect(list.count).toBe(1);
      expect(list.sessions?.[0]).toMatchObject({ key: "agent:main:main", label: "Rust Main" });

      await client.request<{ status?: string }>("wake", { text: "wake from client test" });
      const lastWake = await client.request<{ status?: string; preview?: string }>(
        "last-main-session-wake",
        {},
      );
      expect(lastWake).toMatchObject({ status: "sent", preview: "wake from client test" });

      fs.appendFileSync(
        created.entry?.sessionFile ?? "",
        `${JSON.stringify({ role: "user", content: "hello from rust" })}\n`,
      );
      const preview = await client.request<{
        previews?: Array<{ key?: string; status?: string; items?: Array<{ text?: string }> }>;
      }>("sessions.preview", { keys: ["agent:main:main"] });
      expect(preview.previews?.[0]?.status).toBe("ok");
      expect(preview.previews?.[0]?.items?.[0]?.text).toBe("hello from rust");

      const scratch = await client.request<{
        key?: string;
        entry?: { sessionFile?: string };
      }>("sessions.create", { key: "scratch", label: "Scratch" });
      expect(scratch.key).toBe("agent:main:scratch");

      const patched = await client.request<{
        ok?: boolean;
        entry?: { label?: string; model?: string };
      }>("sessions.patch", { key: "agent:main:scratch", label: "Renamed", model: "gpt-5.4" });
      expect(patched.ok).toBe(true);
      expect(patched.entry).toMatchObject({ label: "Renamed", model: "gpt-5.4" });

      const resolved = await client.request<{ ok?: boolean; key?: string }>("sessions.resolve", {
        label: "Renamed",
      });
      expect(resolved).toMatchObject({ ok: true, key: "agent:main:scratch" });

      fs.appendFileSync(
        scratch.entry?.sessionFile ?? "",
        [
          JSON.stringify({ role: "user", content: "first scratch line" }),
          JSON.stringify({ role: "assistant", content: "second scratch line" }),
          "",
        ].join("\n"),
      );
      const messages = await client.request<{ messages?: Array<{ content?: string }> }>(
        "sessions.get",
        { key: "agent:main:scratch" },
      );
      expect(messages.messages?.map((message) => message.content)).toEqual([
        "first scratch line",
        "second scratch line",
      ]);

      const sessionSubscription = await client.request<{ subscribed?: boolean }>(
        "sessions.subscribe",
        {},
      );
      expect(sessionSubscription.subscribed).toBe(true);
      const messageSubscription = await client.request<{ subscribed?: boolean; key?: string }>(
        "sessions.messages.subscribe",
        { key: "agent:main:scratch" },
      );
      expect(messageSubscription).toMatchObject({
        subscribed: true,
        key: "agent:main:scratch",
      });

      const sessionMessageEvent = waitForGatewayEvent(events, (event) => {
        const payload = event.payload as { sessionKey?: string } | undefined;
        return event.event === "session.message" && payload?.sessionKey === "agent:main:scratch";
      });
      const sessionsChangedEvent = waitForGatewayEvent(events, (event) => {
        const payload = event.payload as { session?: { key?: string } } | undefined;
        return event.event === "sessions.changed" && payload?.session?.key === "agent:main:scratch";
      });
      await client.request<{ status?: string }>("sessions.send", {
        key: "agent:main:scratch",
        message: "message from subscription",
      });
      const [messageEvent, changedEvent] = await Promise.all([
        sessionMessageEvent,
        sessionsChangedEvent,
      ]);
      expect(messageEvent).toMatchObject({
        event: "session.message",
        payload: {
          content: "message from subscription",
          role: "user",
          sessionKey: "agent:main:scratch",
        },
      });
      expect(changedEvent).toMatchObject({
        event: "sessions.changed",
        payload: {
          session: {
            key: "agent:main:scratch",
          },
        },
      });

      const injected = await client.request<{ ok?: boolean; messageId?: string }>("chat.inject", {
        sessionKey: "agent:main:scratch",
        message: "assistant injected from rust",
      });
      expect(injected.ok).toBe(true);
      expect(injected.messageId).toMatch(/^inject-/);

      const chatHistory = await client.request<{
        sessionKey?: string;
        messages?: Array<{ role?: string; content?: string }>;
      }>("chat.history", { sessionKey: "agent:main:scratch", limit: 2 });
      expect(chatHistory.sessionKey).toBe("agent:main:scratch");
      expect(chatHistory.messages?.map((message) => message.content)).toEqual([
        "message from subscription",
        "assistant injected from rust",
      ]);

      const abort = await client.request<{ ok?: boolean; aborted?: boolean; runIds?: string[] }>(
        "chat.abort",
        { sessionKey: "agent:main:scratch", runId: "not-running" },
      );
      expect(abort).toMatchObject({ ok: true, aborted: false, runIds: ["not-running"] });

      const compacted = await client.request<{ ok?: boolean; compacted?: boolean; kept?: number }>(
        "sessions.compact",
        { key: "agent:main:scratch", maxLines: 1 },
      );
      expect(compacted).toMatchObject({ ok: true, compacted: true, kept: 1 });

      const reset = await client.request<{
        ok?: boolean;
        key?: string;
        entry?: { sessionId?: string };
      }>("sessions.reset", { key: "agent:main:scratch" });
      expect(reset.ok).toBe(true);
      expect(reset.key).toBe("agent:main:scratch");
      expect(reset.entry?.sessionId).toBeTruthy();

      const deleted = await client.request<{ ok?: boolean; deleted?: boolean }>("sessions.delete", {
        key: "agent:main:scratch",
      });
      expect(deleted).toMatchObject({ ok: true, deleted: true });
    } finally {
      await client?.stopAndWait({ timeoutMs: 1_000 });
    }
  }, 30_000);

  it("requires configured shared auth credentials during connect", async () => {
    const port = await getFreePort();
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-rust-gateway-auth-"));
    tempDirs.push(stateDir);
    const child = spawnRustGateway(port, {
      CRAWCLAW_GATEWAY_TOKEN: "test-token",
      CRAWCLAW_STATE_DIR: stateDir,
    });
    children.push(child);
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });

    await waitForHealth(port, () => stderr);

    const unauthorized = startGatewayClient(port);
    await expect(unauthorized.hello).rejects.toThrow(/token/i);
    await unauthorized.client.stopAndWait({ timeoutMs: 1_000 });

    const authorized = startGatewayClient(port, { token: "test-token" });
    try {
      const hello = await authorized.hello;
      expect(hello.snapshot?.authMode).toBe("token");
    } finally {
      await authorized.client.stopAndWait({ timeoutMs: 1_000 });
    }
  }, 30_000);
});

function startGatewayClient(
  port: number,
  options: Partial<GatewayClientOptions> = {},
): { client: GatewayClient; hello: Promise<HelloOk> } {
  let resolveHello: (hello: HelloOk) => void = () => undefined;
  let rejectHello: (error: unknown) => void = () => undefined;
  const hello = new Promise<HelloOk>((resolve, reject) => {
    resolveHello = resolve;
    rejectHello = reject;
  });
  const client = new GatewayClient({
    url: `ws://127.0.0.1:${port}`,
    clientName: "gateway-client",
    clientVersion: "test",
    platform: "test",
    mode: "cli",
    deviceIdentity: null,
    requestTimeoutMs: 5_000,
    connectChallengeTimeoutMs: 5_000,
    ...options,
    onHelloOk: resolveHello,
    onConnectError: rejectHello,
  });
  client.start();
  return { client, hello };
}

function waitForGatewayEvent(
  events: EventFrame[],
  predicate: (event: EventFrame) => boolean,
): Promise<EventFrame> {
  const existing = events.find(predicate);
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const event = events.find(predicate);
      if (event) {
        clearInterval(timer);
        resolve(event);
        return;
      }
      if (Date.now() - started > 2_000) {
        clearInterval(timer);
        reject(new Error("timed out waiting for gateway event"));
      }
    }, 10);
  });
}

function spawnRustGateway(port: number, extraEnv: NodeJS.ProcessEnv = {}): RustGatewayChild {
  const debugBinary = path.join(repoRoot, "target", "debug", "crawclaw-gateway");
  ensureRustGatewayBinary(debugBinary);
  if (fs.existsSync(debugBinary)) {
    return spawn(debugBinary, ["--bind", "127.0.0.1", "--port", String(port)], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CARGO_HOME: process.env.CARGO_HOME ?? path.join(toolchainHome, ".cargo"),
        RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(toolchainHome, ".rustup"),
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  return spawn(
    "cargo",
    [
      "run",
      "--quiet",
      "-p",
      "crawclaw-gateway",
      "--",
      "--bind",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        CARGO_HOME: process.env.CARGO_HOME ?? path.join(toolchainHome, ".cargo"),
        RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(toolchainHome, ".rustup"),
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

function ensureRustGatewayBinary(debugBinary: string): void {
  if (debugGatewayBuilt) {
    return;
  }
  const result = spawnSync("cargo", ["build", "-q", "-p", "crawclaw-gateway"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CARGO_HOME: process.env.CARGO_HOME ?? path.join(toolchainHome, ".cargo"),
      RUSTUP_HOME: process.env.RUSTUP_HOME ?? path.join(toolchainHome, ".rustup"),
    },
  });
  if (result.status !== 0) {
    throw new Error(
      `cargo build -q -p crawclaw-gateway failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  if (!fs.existsSync(debugBinary)) {
    throw new Error(`cargo build did not create ${debugBinary}`);
  }
  debugGatewayBuilt = true;
}

function createGitUpdateRoot(): string {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-rust-runtime-"));
  tempDirs.push(runtimeRoot);
  runGit(runtimeRoot, ["init", "-q"]);
  runGit(runtimeRoot, ["config", "user.email", "test@example.com"]);
  runGit(runtimeRoot, ["config", "user.name", "Test User"]);
  fs.writeFileSync(
    path.join(runtimeRoot, "package.json"),
    `${JSON.stringify({ name: "crawclaw", version: "0.0.0" })}\n`,
  );
  runGit(runtimeRoot, ["add", "package.json"]);
  runGit(runtimeRoot, ["commit", "-q", "-m", "init"]);
  return runtimeRoot;
}

function runGit(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

function resolveToolchainHome(): string {
  const candidates = [os.homedir(), process.env.HOME, path.dirname(repoRoot)].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  return (
    candidates.find((home) => fs.existsSync(path.join(home, ".rustup"))) ?? candidates[0] ?? "."
  );
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }
        reject(new Error("failed to allocate test port"));
      });
    });
  });
}

async function waitForHealth(port: number, stderr: () => string) {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`health returned ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`rust gateway did not become healthy: ${String(lastError)}\n${stderr()}`);
}

async function stopChild(child: RustGatewayChild) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill();
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 1_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
