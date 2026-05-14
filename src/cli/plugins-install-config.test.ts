import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { loadConfigForInstall } from "./plugins-install-command.js";

const hoisted = vi.hoisted(() => ({
  loadConfigMock: vi.fn<() => CrawClawConfig>(),
}));

const loadConfigMock = hoisted.loadConfigMock;

vi.mock("../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

describe("loadConfigForInstall", () => {
  const request = {
    rawSpec: "@crawclaw/acpx",
    normalizedSpec: "@crawclaw/acpx",
  };

  beforeEach(() => {
    loadConfigMock.mockReset();
  });

  it("returns the config directly when loadConfig succeeds", async () => {
    const cfg = { plugins: { entries: { acpx: { enabled: true } } } } as CrawClawConfig;
    loadConfigMock.mockReturnValue(cfg);

    await expect(loadConfigForInstall(request)).resolves.toBe(cfg);
  });

  it("rejects invalid config without legacy channel recovery", async () => {
    const invalidConfigErr = new Error("config invalid");
    (invalidConfigErr as { code?: string }).code = "INVALID_CONFIG";
    loadConfigMock.mockImplementation(() => {
      throw invalidConfigErr;
    });

    await expect(loadConfigForInstall(request)).rejects.toThrow(
      "Config invalid; run `crawclaw doctor --fix` before installing plugins.",
    );
  });

  it("rethrows non-config errors from loadConfig", async () => {
    const fsErr = new Error("EACCES: permission denied");
    (fsErr as { code?: string }).code = "EACCES";
    loadConfigMock.mockImplementation(() => {
      throw fsErr;
    });

    await expect(loadConfigForInstall(request)).rejects.toThrow("EACCES: permission denied");
  });
});
