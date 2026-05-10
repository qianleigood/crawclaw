import { describe, expect, it, vi, beforeEach } from "vitest";

const execMocks = vi.hoisted(() => ({
  runCommandWithTimeout: vi.fn(),
}));

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: execMocks.runCommandWithTimeout,
}));

import {
  resolveNativePluginRuntimeArgv,
  runNativePluginOperation,
} from "./native-plugin-runtime.js";

describe("native plugin runtime helper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("honors explicit native runtime binary overrides", () => {
    expect(
      resolveNativePluginRuntimeArgv({
        env: { CRAWCLAW_NATIVE_PLUGINS_BIN: "/tmp/crawclaw-native-plugins" },
        existsSync: () => false,
      }),
    ).toEqual(["/tmp/crawclaw-native-plugins"]);
  });

  it("falls back to cargo run inside a Rust workspace", () => {
    expect(
      resolveNativePluginRuntimeArgv({
        cwd: "/repo",
        existsSync: (candidate) => candidate === "/repo/Cargo.toml",
      }),
    ).toEqual(["cargo", "run", "--quiet", "-p", "crawclaw-native-plugins", "--"]);
  });

  it("passes plugin operation input through stdin and unwraps success envelopes", async () => {
    execMocks.runCommandWithTimeout.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({ ok: true, result: { value: 1 } }),
      stderr: "",
    });

    await expect(
      runNativePluginOperation({
        plugin: "llm-task",
        operation: "prepare",
        input: { prompt: "x" },
        env: { CRAWCLAW_NATIVE_PLUGINS_BIN: "/tmp/native" },
      }),
    ).resolves.toEqual({ value: 1 });

    expect(execMocks.runCommandWithTimeout).toHaveBeenCalledWith(
      ["/tmp/native", "llm-task", "prepare"],
      expect.objectContaining({
        input: JSON.stringify({ prompt: "x" }),
      }),
    );
  });

  it("turns native error envelopes into normal plugin errors", async () => {
    execMocks.runCommandWithTimeout.mockResolvedValueOnce({
      code: 0,
      stdout: JSON.stringify({ ok: false, code: "invalid_input", message: "prompt required" }),
      stderr: "",
    });

    await expect(
      runNativePluginOperation({
        plugin: "llm-task",
        operation: "prepare",
        env: { CRAWCLAW_NATIVE_PLUGINS_BIN: "/tmp/native" },
      }),
    ).rejects.toThrow("invalid_input: prompt required");
  });
});
