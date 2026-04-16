import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";

const createContextMemoryRuntimeMock = vi.fn();
const resolveMemoryConfigMock = vi.fn();
const runtimeStoreInitMock = vi.fn();

vi.mock("./context-memory-runtime.js", () => ({
  createContextMemoryRuntime: createContextMemoryRuntimeMock,
}));

vi.mock("../config/resolve.js", () => ({
  resolveMemoryConfig: resolveMemoryConfigMock,
}));

vi.mock("../runtime/sqlite-runtime-store.js", () => ({
  SqliteRuntimeStore: class SqliteRuntimeStore {
    async init() {
      return await runtimeStoreInitMock();
    }
  },
}));

describe("resolveConfiguredBuiltInMemoryRuntime", () => {
  beforeEach(() => {
    vi.resetModules();
    createContextMemoryRuntimeMock.mockReset();
    resolveMemoryConfigMock.mockReset();
    runtimeStoreInitMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("publishes bootstrap cache governance metadata and reset helpers", async () => {
    const {
      BUILT_IN_MEMORY_RUNTIME_BOOTSTRAP_CACHE_DESCRIPTOR,
      getBuiltInMemoryRuntimeBootstrapCacheMeta,
      resetConfiguredBuiltInMemoryRuntimeCache,
    } = await import("./built-in-memory-runtime.js");

    expect(BUILT_IN_MEMORY_RUNTIME_BOOTSTRAP_CACHE_DESCRIPTOR.category).toBe("runtime_ttl");
    expect(getBuiltInMemoryRuntimeBootstrapCacheMeta()).toEqual({ cached: false });

    resetConfiguredBuiltInMemoryRuntimeCache();
    expect(getBuiltInMemoryRuntimeBootstrapCacheMeta()).toEqual({ cached: false });
  });

  it("returns undefined when built-in memory config is absent", async () => {
    const { resolveConfiguredBuiltInMemoryRuntime } = await import("./built-in-memory-runtime.js");

    const result = await resolveConfiguredBuiltInMemoryRuntime({} as CrawClawConfig);

    expect(result).toBeUndefined();
    expect(resolveMemoryConfigMock).not.toHaveBeenCalled();
  });

  it("merges notebooklm and contextArchive into the built-in configuration source", async () => {
    const runtime = { info: { id: "builtin-memory", name: "CrawClaw Memory" } };
    createContextMemoryRuntimeMock.mockReturnValue(runtime);
    resolveMemoryConfigMock.mockImplementation((raw) => ({
      runtimeStore: { dbPath: raw?.dbPath ?? "/tmp/gm.sqlite" },
      notebooklm: { enabled: true, cli: { enabled: true } },
      contextArchive: { mode: "full", rootDir: "/tmp/archive" },
      skillRouting: {},
      llm: undefined,
    }));
    const { resolveConfiguredBuiltInMemoryRuntime } = await import("./built-in-memory-runtime.js");
    const cfg = {
      memory: {
        notebooklm: {
          enabled: true,
          cli: {
            enabled: true,
            notebookId: "nb-1",
          },
        },
        contextArchive: {
          mode: "full",
          rootDir: "/tmp/archive",
        },
      },
    } as unknown as CrawClawConfig;

    await resolveConfiguredBuiltInMemoryRuntime(cfg);

    expect(resolveMemoryConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notebooklm: expect.objectContaining({
          enabled: true,
          cli: expect.objectContaining({ notebookId: "nb-1" }),
        }),
        contextArchive: expect.objectContaining({
          mode: "full",
          rootDir: "/tmp/archive",
        }),
      }),
    );
  });

  it("bootstraps a built-in runtime when memory.notebooklm is configured", async () => {
    const runtime = { info: { id: "builtin-memory", name: "CrawClaw Memory" } };
    createContextMemoryRuntimeMock.mockReturnValue(runtime);
    resolveMemoryConfigMock.mockReturnValue({
      runtimeStore: { dbPath: "/tmp/gm.sqlite" },
      notebooklm: { enabled: true, cli: { enabled: true } },
      skillRouting: {},
      llm: undefined,
    });
    const { getBuiltInMemoryRuntimeBootstrapCacheMeta, resolveConfiguredBuiltInMemoryRuntime } =
      await import("./built-in-memory-runtime.js");
    const cfg = {
      memory: {
        notebooklm: { enabled: true },
      },
      agents: {
        defaults: {
          model: {
            primary: "openai/mock-1",
          },
        },
      },
      models: {
        providers: {
          openai: {
            api: "openai-responses",
            apiKey: "test-key",
            baseUrl: "https://example.com/openai",
            models: [{ id: "mock-1" }],
          },
        },
      },
    } as unknown as CrawClawConfig;

    const result = await resolveConfiguredBuiltInMemoryRuntime(cfg);

    expect(result).toBe(runtime);
    expect(resolveMemoryConfigMock).toHaveBeenCalledTimes(1);
    expect(runtimeStoreInitMock).toHaveBeenCalledTimes(1);
    expect(createContextMemoryRuntimeMock).toHaveBeenCalledTimes(1);
    expect(getBuiltInMemoryRuntimeBootstrapCacheMeta()).toEqual({ cached: true });
  });

  it("bypasses the shared bootstrap cache when a dynamic complete fn is supplied", async () => {
    const runtimeA = { info: { id: "builtin-memory-a", name: "CrawClaw Memory A" } };
    const runtimeB = { info: { id: "builtin-memory-b", name: "CrawClaw Memory B" } };
    const completeA = vi.fn();
    const completeB = vi.fn();
    createContextMemoryRuntimeMock.mockReturnValueOnce(runtimeA).mockReturnValueOnce(runtimeB);
    resolveMemoryConfigMock.mockReturnValue({
      runtimeStore: { dbPath: "/tmp/gm.sqlite" },
      notebooklm: { enabled: true, cli: { enabled: true } },
      skillRouting: {},
      llm: undefined,
    });
    const { resolveConfiguredBuiltInMemoryRuntime } = await import("./built-in-memory-runtime.js");
    const cfg = {
      memory: {
        notebooklm: { enabled: true },
      },
    } as unknown as CrawClawConfig;

    const resultA = await resolveConfiguredBuiltInMemoryRuntime(cfg, { complete: completeA });
    const resultB = await resolveConfiguredBuiltInMemoryRuntime(cfg, { complete: completeB });

    expect(resultA).toBe(runtimeA);
    expect(resultB).toBe(runtimeB);
    expect(createContextMemoryRuntimeMock).toHaveBeenCalledTimes(2);
    expect(createContextMemoryRuntimeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ complete: completeA }),
    );
    expect(createContextMemoryRuntimeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ complete: completeB }),
    );
  });
});
