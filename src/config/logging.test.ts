import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/text.js";

const mocks = vi.hoisted(() => ({
  createConfigIO: vi.fn().mockReturnValue({
    configPath: "/tmp/crawclaw-dev/crawclaw.json",
  }),
}));

vi.mock("./io.js", () => ({
  createConfigIO: mocks.createConfigIO,
}));

let formatConfigPath: typeof import("./logging.js").formatConfigPath;
let logConfigUpdated: typeof import("./logging.js").logConfigUpdated;

beforeAll(async () => {
  ({ formatConfigPath, logConfigUpdated } = await import("./logging.js"));
});

beforeEach(() => {
  mocks.createConfigIO.mockClear();
  setActiveCliLocale("en");
});

describe("config logging", () => {
  it("formats the live config path when no explicit path is provided", () => {
    expect(formatConfigPath()).toBe("/tmp/crawclaw-dev/crawclaw.json");
  });

  it("logs the live config path when no explicit path is provided", () => {
    const runtime = { log: vi.fn() };
    logConfigUpdated(runtime as never);
    expect(runtime.log).toHaveBeenCalledWith("Updated /tmp/crawclaw-dev/crawclaw.json");
  });

  it("localizes the update message when zh-CN is active", () => {
    setActiveCliLocale("zh-CN");
    const runtime = { log: vi.fn() };
    logConfigUpdated(runtime as never);
    expect(runtime.log).toHaveBeenCalledWith("已更新 /tmp/crawclaw-dev/crawclaw.json");
  });
});
