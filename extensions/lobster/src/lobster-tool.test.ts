import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrawClawPluginApi, CrawClawPluginToolContext } from "../runtime-api.js";
import {
  createWindowsCmdShimFixture,
  restorePlatformPathEnv,
  setProcessPlatform,
  snapshotPlatformPathEnv,
} from "./test-helpers.js";
import { resolveWindowsLobsterSpawn } from "./windows-spawn.js";

const nativeMocks = vi.hoisted(() => ({
  runNativePluginOperation: vi.fn(),
}));

vi.mock("crawclaw/plugin-sdk/native-plugin-runtime", () => ({
  runNativePluginOperation: nativeMocks.runNativePluginOperation,
}));

import { createLobsterTool } from "./lobster-tool.js";

function fakeApi(overrides: Partial<CrawClawPluginApi> = {}): CrawClawPluginApi {
  return {
    id: "lobster",
    name: "lobster",
    source: "test",
    registrationMode: "full",
    config: {},
    pluginConfig: {},
    runtime: { version: "test" } as CrawClawPluginApi["runtime"],
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    registerTool() {},
    registerChannel() {},
    registerGatewayMethod() {},
    registerCli() {},
    registerService() {},
    registerCliBackend() {},
    registerProvider() {},
    registerSpeechProvider() {},
    registerMediaUnderstandingProvider() {},
    registerWebFetchProvider() {},
    registerWebSearchProvider() {},
    registerInteractiveHandler() {},
    onConversationBindingResolved() {},
    registerHook() {},
    registerHttpRoute() {},
    registerCommand() {},
    on() {},
    resolvePath: (p) => p,
    ...overrides,
  };
}

function fakeCtx(overrides: Partial<CrawClawPluginToolContext> = {}): CrawClawPluginToolContext {
  return {
    config: {},
    workspaceDir: "/tmp",
    agentDir: "/tmp",
    agentId: "main",
    sessionKey: "main",
    messageChannel: undefined,
    agentAccountId: undefined,
    sandboxed: false,
    ...overrides,
  };
}

async function expectUnwrappedShim(params: {
  scriptPath: string;
  shimPath: string;
  shimLine: string;
}) {
  await createWindowsCmdShimFixture(params);

  const target = resolveWindowsLobsterSpawn(params.shimPath, ["run", "noop"], process.env);
  expect(target.command).toBe(process.execPath);
  expect(target.argv).toEqual([params.scriptPath, "run", "noop"]);
  expect(target.windowsHide).toBe(true);
}

describe("lobster plugin tool", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs lobster through the Rust native plugin runtime", async () => {
    nativeMocks.runNativePluginOperation.mockResolvedValueOnce({
      content: [{ type: "text", text: "{}" }],
      details: { ok: true, status: "ok" },
    });

    const tool = createLobsterTool(fakeApi());
    const res = await tool.execute("call1", {
      action: "run",
      pipeline: "noop",
      timeoutMs: 1000,
    });

    expect(nativeMocks.runNativePluginOperation).toHaveBeenCalledWith({
      plugin: "lobster",
      operation: "execute",
      input: {
        params: { action: "run", pipeline: "noop", timeoutMs: 1000 },
        cwd: process.cwd(),
      },
      timeoutMs: 1000,
    });
    expect(res.details).toMatchObject({ ok: true, status: "ok" });
  });

  it("rejects absolute cwd before invoking the native runtime", async () => {
    const tool = createLobsterTool(fakeApi());
    await expect(
      tool.execute("call2c", {
        action: "run",
        pipeline: "noop",
        cwd: "/tmp",
      }),
    ).rejects.toThrow(/cwd must be a relative path/);
    expect(nativeMocks.runNativePluginOperation).not.toHaveBeenCalled();
  });

  it("rejects cwd that escapes the gateway working directory", async () => {
    const tool = createLobsterTool(fakeApi());
    await expect(
      tool.execute("call2d", {
        action: "run",
        pipeline: "noop",
        cwd: "../../etc",
      }),
    ).rejects.toThrow(/must stay within/);
    expect(nativeMocks.runNativePluginOperation).not.toHaveBeenCalled();
  });

  it("can be gated off in sandboxed contexts", () => {
    const api = fakeApi();
    const factoryTool = (ctx: CrawClawPluginToolContext) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api);
    };

    expect(factoryTool(fakeCtx({ sandboxed: true }))).toBeNull();
    expect(factoryTool(fakeCtx({ sandboxed: false }))?.name).toBe("lobster");
  });
});

describe("resolveWindowsLobsterSpawn", () => {
  let tempDir = "";
  const originalProcessState = snapshotPlatformPathEnv();

  afterEach(async () => {
    restorePlatformPathEnv(originalProcessState);
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = "";
    }
  });

  async function makeWindowsTempDir() {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-lobster-win-spawn-"));
    setProcessPlatform("win32");
    return tempDir;
  }

  it("unwraps cmd shim with %dp0% token", async () => {
    const dir = await makeWindowsTempDir();
    const scriptPath = path.join(dir, "shim-dist", "lobster-cli.cjs");
    const shimPath = path.join(dir, "shim", "lobster.cmd");
    await expectUnwrappedShim({
      shimPath,
      scriptPath,
      shimLine: `"%dp0%\\..\\shim-dist\\lobster-cli.cjs" %*`,
    });
  });

  it("unwraps cmd shim with %~dp0% token", async () => {
    const dir = await makeWindowsTempDir();
    const scriptPath = path.join(dir, "shim-dist", "lobster-cli.cjs");
    const shimPath = path.join(dir, "shim", "lobster.cmd");
    await expectUnwrappedShim({
      shimPath,
      scriptPath,
      shimLine: `"%~dp0%\\..\\shim-dist\\lobster-cli.cjs" %*`,
    });
  });

  it("ignores node.exe shim entries and picks lobster script", async () => {
    const dir = await makeWindowsTempDir();
    const shimDir = path.join(dir, "shim-with-node");
    const scriptPath = path.join(dir, "shim-dist-node", "lobster-cli.cjs");
    const shimPath = path.join(shimDir, "lobster.cmd");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.mkdir(shimDir, { recursive: true });
    await fs.writeFile(path.join(shimDir, "node.exe"), "", "utf8");
    await fs.writeFile(scriptPath, "module.exports = {};\n", "utf8");
    await fs.writeFile(
      shimPath,
      `@echo off\r\n"%~dp0%\\node.exe" "%~dp0%\\..\\shim-dist-node\\lobster-cli.cjs" %*\r\n`,
      "utf8",
    );

    const target = resolveWindowsLobsterSpawn(shimPath, ["run", "noop"], process.env);
    expect(target.command).toBe(process.execPath);
    expect(target.argv).toEqual([scriptPath, "run", "noop"]);
    expect(target.windowsHide).toBe(true);
  });

  it("resolves lobster.cmd from PATH and unwraps npm layout shim", async () => {
    const dir = await makeWindowsTempDir();
    const binDir = path.join(dir, "node_modules", ".bin");
    const packageDir = path.join(dir, "node_modules", "lobster");
    const scriptPath = path.join(packageDir, "dist", "cli.js");
    const shimPath = path.join(binDir, "lobster.cmd");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(shimPath, "@echo off\r\n", "utf8");
    await fs.writeFile(
      path.join(packageDir, "package.json"),
      JSON.stringify({ name: "lobster", version: "0.0.0", bin: { lobster: "dist/cli.js" } }),
      "utf8",
    );
    await fs.writeFile(scriptPath, "module.exports = {};\n", "utf8");

    const env = {
      ...process.env,
      PATH: `${binDir};${process.env.PATH ?? ""}`,
      PATHEXT: ".CMD;.EXE",
    };
    const target = resolveWindowsLobsterSpawn("lobster", ["run", "noop"], env);
    expect(target.command).toBe(process.execPath);
    expect(target.argv).toEqual([scriptPath, "run", "noop"]);
    expect(target.windowsHide).toBe(true);
  });

  it("fails fast when wrapper cannot be resolved without shell execution", async () => {
    const dir = await makeWindowsTempDir();
    const badShimPath = path.join(dir, "bad-shim", "lobster.cmd");
    await fs.mkdir(path.dirname(badShimPath), { recursive: true });
    await fs.writeFile(badShimPath, "@echo off\r\nREM no entrypoint\r\n", "utf8");

    expect(() => resolveWindowsLobsterSpawn(badShimPath, ["run", "noop"], process.env)).toThrow(
      /without shell execution/,
    );
  });
});
