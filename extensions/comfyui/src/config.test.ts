import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertPathInside, resolveComfyUiConfig } from "./config.js";

describe("resolveComfyUiConfig", () => {
  it("defaults to local loopback ComfyUI and workspace output paths", () => {
    const config = resolveComfyUiConfig({ workspaceDir: "/tmp/workspace", pluginConfig: {} });

    expect(config.baseUrl).toBe("http://127.0.0.1:8188");
    expect(config.outputDir).toBe(path.join("/tmp/workspace", ".crawclaw/comfyui/outputs"));
    expect(config.workflowsDir).toBe(path.join("/tmp/workspace", ".crawclaw/comfyui/workflows"));
    expect(config.maxPlanRepairAttempts).toBe(3);
  });

  it("rejects non-loopback URLs unless allowRemote is true", () => {
    expect(() =>
      resolveComfyUiConfig({
        workspaceDir: "/tmp/workspace",
        pluginConfig: { baseUrl: "http://192.168.1.10:8188" },
      }),
    ).toThrow(/non-loopback/i);

    expect(
      resolveComfyUiConfig({
        workspaceDir: "/tmp/workspace",
        pluginConfig: { baseUrl: "http://192.168.1.10:8188", allowRemote: true },
      }).baseUrl,
    ).toBe("http://192.168.1.10:8188");
  });
});

describe("assertPathInside", () => {
  it("blocks paths that escape the configured root", () => {
    expect(() =>
      assertPathInside("/tmp/workspace/out", "/tmp/workspace/out/file.png"),
    ).not.toThrow();
    expect(() => assertPathInside("/tmp/workspace/out", "/tmp/workspace/other/file.png")).toThrow(
      /outside/i,
    );
  });
});
