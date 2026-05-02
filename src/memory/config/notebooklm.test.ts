import { describe, expect, it } from "vitest";
import { normalizeNotebookLmConfig } from "./notebooklm.js";

describe("normalizeNotebookLmConfig", () => {
  it("exposes NotebookLM writeback settings without a second enabled gate", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      cli: {
        enabled: true,
        notebookId: "nb-1",
      },
    });

    expect((config.write as { enabled?: unknown }).enabled).toBeUndefined();
    expect(config.write.command).toBe("");
    expect(config.write.notebookId).toBe("");
  });

  it("ignores legacy writeback enabled settings", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      write: {
        enabled: false,
      },
    } as unknown as Parameters<typeof normalizeNotebookLmConfig>[0]);

    expect((config.write as { enabled?: unknown }).enabled).toBeUndefined();
  });

  it("does not expose source upload config by default", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      cli: {
        enabled: true,
        notebookId: "nb-1",
      },
    });

    expect((config as { source?: unknown }).source).toBeUndefined();
  });

  it("ignores legacy source upload settings", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      source: {
        enabled: true,
        title: "Legacy Source",
      },
    } as unknown as Parameters<typeof normalizeNotebookLmConfig>[0]);

    expect((config as { source?: unknown }).source).toBeUndefined();
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
