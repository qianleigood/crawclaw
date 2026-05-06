import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: spawnMock,
    spawnSync: spawnSyncMock,
  };
});

describe("qwen3-tts daemon manager", () => {
  let ensureManagedQwen3TtsDaemon: typeof import("./daemon.js").ensureManagedQwen3TtsDaemon;

  beforeEach(async () => {
    vi.resetModules();
    spawnMock.mockReset().mockImplementation(() => {
      const child = {
        exitCode: null,
        signalCode: null,
        once: vi.fn().mockReturnThis(),
        unref: vi.fn(),
      };
      return child;
    });
    spawnSyncMock.mockReset().mockReturnValue({ status: 0, stderr: "", stdout: "ok\n" });
    vi.unstubAllGlobals();
    ({ ensureManagedQwen3TtsDaemon } = await import("./daemon.js"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips spawning when autoStart is disabled", async () => {
    const baseUrl = await ensureManagedQwen3TtsDaemon({
      enabled: true,
      supported: true,
      experimental: false,
      runtime: "mlx-audio",
      baseUrl: "http://127.0.0.1:8011",
      autoStart: false,
      startupTimeoutMs: 30_000,
      healthPath: "/health",
      managedRuntime: false,
      defaultProfile: "assistant",
      voiceDirectory: "/tmp/voices",
      agentProfiles: {},
      profiles: {},
    });

    expect(baseUrl).toBe("http://127.0.0.1:8011");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("returns immediately when the local sidecar is already healthy", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const baseUrl = await ensureManagedQwen3TtsDaemon({
      enabled: true,
      supported: true,
      experimental: false,
      runtime: "mlx-audio",
      baseUrl: "http://127.0.0.1:8011",
      autoStart: true,
      startupTimeoutMs: 30_000,
      healthPath: "/health",
      managedRuntime: false,
      defaultProfile: "assistant",
      voiceDirectory: "/tmp/voices",
      agentProfiles: {},
      profiles: {},
    });

    expect(baseUrl).toBe("http://127.0.0.1:8011");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8011/health",
      expect.objectContaining({
        headers: { Accept: "application/json" },
      }),
    );
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("spawns the configured sidecar command when loopback is not ready", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureManagedQwen3TtsDaemon({
        enabled: true,
        supported: true,
        experimental: false,
        runtime: "vllm-omni",
        baseUrl: "http://127.0.0.1:8010",
        autoStart: true,
        startupTimeoutMs: 30_000,
        healthPath: "/health",
        managedRuntime: false,
        launchCommand: "python",
        launchArgs: ["-m", "qwen_tts_sidecar"],
        launchCwd: "/tmp/qwen3-sidecar",
        defaultProfile: "assistant",
        voiceDirectory: "/tmp/voices",
        agentProfiles: {},
        profiles: {},
      }),
    ).resolves.toBe("http://127.0.0.1:8010");

    expect(spawnMock).toHaveBeenCalledWith(
      "python",
      ["-m", "qwen_tts_sidecar"],
      expect.objectContaining({
        cwd: "/tmp/qwen3-sidecar",
        detached: true,
      }),
    );
  });

  it("verifies the managed MLX runtime before spawning the bundled sidecar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureManagedQwen3TtsDaemon({
        enabled: true,
        supported: true,
        experimental: false,
        runtime: "mlx-audio",
        baseUrl: "http://127.0.0.1:8011",
        autoStart: true,
        startupTimeoutMs: 30_000,
        healthPath: "/health",
        managedRuntime: "mlx-audio",
        launchCommand: "/tmp/crawclaw/runtimes/qwen3-tts/venv/bin/python",
        launchArgs: ["/tmp/qwen3_tts_sidecar.py", "--port", "8011"],
        defaultProfile: "assistant",
        voiceDirectory: "/tmp/voices",
        agentProfiles: {},
        profiles: {},
      }),
    ).resolves.toBe("http://127.0.0.1:8011");

    expect(spawnSyncMock).toHaveBeenCalledWith(
      "/tmp/crawclaw/runtimes/qwen3-tts/venv/bin/python",
      ["-c", expect.stringContaining("import mlx_audio")],
      expect.objectContaining({
        encoding: "utf8",
        stdio: "pipe",
      }),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      "/tmp/crawclaw/runtimes/qwen3-tts/venv/bin/python",
      ["/tmp/qwen3_tts_sidecar.py", "--port", "8011"],
      expect.objectContaining({
        detached: true,
      }),
    );
  });

  it("fails fast when the managed MLX runtime is not installed", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetchMock);
    spawnSyncMock.mockReturnValueOnce({
      status: 1,
      stderr: "ModuleNotFoundError: No module named 'mlx_audio'",
      stdout: "",
    });

    await expect(
      ensureManagedQwen3TtsDaemon({
        enabled: true,
        supported: true,
        experimental: false,
        runtime: "mlx-audio",
        baseUrl: "http://127.0.0.1:8011",
        autoStart: true,
        startupTimeoutMs: 30_000,
        healthPath: "/health",
        managedRuntime: "mlx-audio",
        launchCommand: "/tmp/crawclaw/runtimes/qwen3-tts/venv/bin/python",
        launchArgs: ["/tmp/qwen3_tts_sidecar.py", "--port", "8011"],
        defaultProfile: "assistant",
        voiceDirectory: "/tmp/voices",
        agentProfiles: {},
        profiles: {},
      }),
    ).rejects.toThrow("Managed Qwen3-TTS runtime is not installed or failed verification");

    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("verifies the managed Python runtime before spawning the bundled Python sidecar", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureManagedQwen3TtsDaemon({
        enabled: true,
        supported: true,
        experimental: false,
        runtime: "qwen-tts",
        baseUrl: "http://127.0.0.1:8013",
        autoStart: true,
        startupTimeoutMs: 30_000,
        healthPath: "/health",
        managedRuntime: "qwen-tts",
        launchCommand: "/tmp/crawclaw/runtimes/qwen3-tts/venv/bin/python",
        launchArgs: ["/tmp/qwen3_tts_python_sidecar.py", "--port", "8013"],
        defaultProfile: "assistant",
        voiceDirectory: "/tmp/voices",
        agentProfiles: {},
        profiles: {},
      }),
    ).resolves.toBe("http://127.0.0.1:8013");

    expect(spawnSyncMock).toHaveBeenCalledWith(
      "/tmp/crawclaw/runtimes/qwen3-tts/venv/bin/python",
      ["-c", expect.stringContaining("import qwen_tts")],
      expect.objectContaining({
        encoding: "utf8",
        stdio: "pipe",
      }),
    );
    expect(spawnMock).toHaveBeenCalledWith(
      "/tmp/crawclaw/runtimes/qwen3-tts/venv/bin/python",
      ["/tmp/qwen3_tts_python_sidecar.py", "--port", "8013"],
      expect.objectContaining({
        detached: true,
      }),
    );
  });

  it("throws a clear error when autoStart is enabled without a launch command", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      ensureManagedQwen3TtsDaemon({
        enabled: true,
        supported: true,
        experimental: false,
        runtime: "qwen3-tts.cpp",
        baseUrl: "http://127.0.0.1:8012",
        autoStart: true,
        startupTimeoutMs: 30_000,
        healthPath: "/health",
        managedRuntime: false,
        defaultProfile: "assistant",
        voiceDirectory: "/tmp/voices",
        agentProfiles: {},
        profiles: {},
      }),
    ).rejects.toThrow("Qwen3-TTS autoStart requires launchCommand");
  });
});
