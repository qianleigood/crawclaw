import { describe, expect, it } from "vitest";
import { normalizeNotebookLmConfig } from "./notebooklm.js";

describe("normalizeNotebookLmConfig", () => {
  it("enables managed NotebookLM writeback by default when NotebookLM is enabled", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      cli: {
        enabled: true,
        notebookId: "nb-1",
      },
    });

    expect(config.write.enabled).toBe(true);
    expect(config.write.command).toBe("");
    expect(config.write.notebookId).toBe("");
  });

  it("preserves an explicit writeback disable", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      write: {
        enabled: false,
      },
    });

    expect(config.write.enabled).toBe(false);
  });

  it("enables the managed NotebookLM source index by default when NotebookLM is enabled", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      cli: {
        enabled: true,
        notebookId: "nb-1",
      },
    });

    expect(config.source?.enabled).toBe(true);
    expect(config.source?.title).toBe("CrawClaw Memory Index");
    expect(config.source?.maxEntries).toBeGreaterThan(0);
  });

  it("preserves an explicit managed source disable", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      source: {
        enabled: false,
      },
    });

    expect(config.source?.enabled).toBe(false);
  });

  it("defaults NotebookLM auto login to the managed profile provider", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
    });

    expect(config.auth.autoLogin).toEqual({
      enabled: true,
      intervalMs: 24 * 60 * 60_000,
      provider: "nlm_profile",
      cdpUrl: "",
    });
  });

  it("normalizes NotebookLM auto login openclaw CDP settings", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      auth: {
        autoLogin: {
          enabled: true,
          intervalMs: 10,
          provider: "openclaw_cdp",
          cdpUrl: "http://127.0.0.1:18800",
        },
      },
    });

    expect(config.auth.autoLogin).toEqual({
      enabled: true,
      intervalMs: 60_000,
      provider: "openclaw_cdp",
      cdpUrl: "http://127.0.0.1:18800",
    });
  });
});
