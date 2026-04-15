import { afterEach, describe, expect, it, vi } from "vitest";
import { importFreshModule } from "../../test/helpers/import-fresh.js";

type LoggerModule = typeof import("./logger.js");

const originalGetBuiltinModule = (
  process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }
).getBuiltinModule;

async function importBrowserSafeLogger(params?: {
  resolvePreferredCrawClawTmpDir?: ReturnType<typeof vi.fn>;
}): Promise<{
  module: LoggerModule;
  resolvePreferredCrawClawTmpDir: ReturnType<typeof vi.fn>;
}> {
  const resolvePreferredCrawClawTmpDir =
    params?.resolvePreferredCrawClawTmpDir ??
    vi.fn(() => {
      throw new Error("resolvePreferredCrawClawTmpDir should not run during browser-safe import");
    });

  vi.doMock("../infra/tmp-crawclaw-dir.js", async () => {
    const actual = await vi.importActual<typeof import("../infra/tmp-crawclaw-dir.js")>(
      "../infra/tmp-crawclaw-dir.js",
    );
    return {
      ...actual,
      resolvePreferredCrawClawTmpDir,
    };
  });

  Object.defineProperty(process, "getBuiltinModule", {
    configurable: true,
    value: undefined,
  });

  const module = await importFreshModule<LoggerModule>(
    import.meta.url,
    "./logger.js?scope=browser-safe",
  );
  return { module, resolvePreferredCrawClawTmpDir };
}

describe("logging/logger browser-safe import", () => {
  afterEach(() => {
    vi.doUnmock("../infra/tmp-crawclaw-dir.js");
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: true,
      value: originalGetBuiltinModule,
    });
  });

  it("does not resolve the preferred temp dir at import time when node fs is unavailable", async () => {
    const { module, resolvePreferredCrawClawTmpDir } = await importBrowserSafeLogger();

    expect(resolvePreferredCrawClawTmpDir).not.toHaveBeenCalled();
    expect(module.DEFAULT_LOG_DIR).toBe("/tmp/crawclaw");
    expect(module.DEFAULT_LOG_FILE).toBe("/tmp/crawclaw/crawclaw.log");
  });

  it("disables file logging when imported in a browser-like environment", async () => {
    const { module, resolvePreferredCrawClawTmpDir } = await importBrowserSafeLogger();

    expect(module.getResolvedLoggerSettings()).toMatchObject({
      level: "silent",
      file: "/tmp/crawclaw/crawclaw.log",
    });
    expect(module.isFileLogLevelEnabled("info")).toBe(false);
    expect(() => module.getLogger().info("browser-safe")).not.toThrow();
    expect(resolvePreferredCrawClawTmpDir).not.toHaveBeenCalled();
  });
});
