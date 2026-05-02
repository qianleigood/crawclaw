import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";

const resolveBuiltInMemoryRuntimeMock = vi.fn();

vi.mock("../engine/memory-runtime.js", () => ({
  resolveBuiltInMemoryRuntime: resolveBuiltInMemoryRuntimeMock,
}));

describe("resolveMemoryRuntime", () => {
  beforeEach(() => {
    resolveBuiltInMemoryRuntimeMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns built-in runtime when available", async () => {
    const builtInRuntime = { info: { id: "builtin", name: "Built-in" } };
    resolveBuiltInMemoryRuntimeMock.mockResolvedValueOnce(builtInRuntime);
    const { resolveMemoryRuntime } = await import("./init-memory-runtime.js");
    const complete = vi.fn();

    const result = await resolveMemoryRuntime({} as CrawClawConfig, { complete });

    expect(result).toBe(builtInRuntime);
    expect(resolveBuiltInMemoryRuntimeMock).toHaveBeenCalledTimes(1);
    expect(resolveBuiltInMemoryRuntimeMock).toHaveBeenCalledWith({} as CrawClawConfig, {
      complete,
    });
  });

  it("uses a minimal built-in runtime path by default when primary built-in runtime is unavailable", async () => {
    const minimalBuiltIn = { info: { id: "builtin-minimal", name: "Built-in minimal" } };
    resolveBuiltInMemoryRuntimeMock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(minimalBuiltIn);
    const { resolveMemoryRuntime } = await import("./init-memory-runtime.js");
    const cfg = {} as CrawClawConfig;

    const result = await resolveMemoryRuntime(cfg);

    expect(result).toBe(minimalBuiltIn);
    expect(resolveBuiltInMemoryRuntimeMock).toHaveBeenCalledTimes(2);
    expect(resolveBuiltInMemoryRuntimeMock).toHaveBeenNthCalledWith(1, cfg, undefined);
    expect(resolveBuiltInMemoryRuntimeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        memory: expect.objectContaining({
          notebooklm: expect.objectContaining({
            enabled: false,
            cli: expect.objectContaining({ enabled: false }),
            write: expect.any(Object),
          }),
          durableExtraction: expect.objectContaining({ enabled: false }),
          sessionSummary: expect.objectContaining({ enabled: false }),
          dreaming: expect.objectContaining({ enabled: false }),
          contextArchive: expect.objectContaining({ mode: "off" }),
        }),
      }),
      undefined,
    );
  });

  it("throws when neither primary nor minimal built-in runtime can be resolved", async () => {
    resolveBuiltInMemoryRuntimeMock.mockResolvedValue(undefined);
    const { resolveMemoryRuntime } = await import("./init-memory-runtime.js");
    const cfg = {} as CrawClawConfig;

    await expect(resolveMemoryRuntime(cfg)).rejects.toThrow(
      "Failed to resolve built-in memory runtime.",
    );
  });
});
