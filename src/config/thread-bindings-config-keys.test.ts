import { describe, expect, it } from "vitest";
import { migrateLegacyConfig } from "./legacy-migrate.js";
import { validateConfigObjectRaw } from "./validation.js";

describe("thread binding config keys", () => {
  it("rejects legacy session.threadBindings.ttlHours", () => {
    const result = validateConfigObjectRaw({
      session: {
        threadBindings: {
          ttlHours: 24,
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: "session.threadBindings",
        message: expect.stringContaining("ttlHours"),
      }),
    );
  });

  it("rejects legacy channels.discord.threadBindings.ttlHours", () => {
    const result = validateConfigObjectRaw({
      channels: {
        discord: {
          threadBindings: {
            ttlHours: 24,
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: "channels.discord.threadBindings",
        message: expect.stringContaining("ttlHours"),
      }),
    );
  });

  it("rejects legacy channels.discord.accounts.<id>.threadBindings.ttlHours", () => {
    const result = validateConfigObjectRaw({
      channels: {
        discord: {
          accounts: {
            alpha: {
              threadBindings: {
                ttlHours: 24,
              },
            },
          },
        },
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        path: "channels.discord.accounts",
        message: expect.stringContaining("ttlHours"),
      }),
    );
  });

  it("does not auto-migrate session.threadBindings.ttlHours", () => {
    const result = migrateLegacyConfig({
      session: {
        threadBindings: {
          ttlHours: 24,
        },
      },
    });

    expect(result).toEqual({ config: null, changes: [] });
  });

  it("does not auto-migrate Discord threadBindings.ttlHours for root and account entries", () => {
    const result = migrateLegacyConfig({
      channels: {
        discord: {
          threadBindings: {
            ttlHours: 12,
          },
          accounts: {
            alpha: {
              threadBindings: {
                ttlHours: 6,
              },
            },
            beta: {
              threadBindings: {
                idleHours: 4,
                ttlHours: 9,
              },
            },
          },
        },
      },
    });

    expect(result).toEqual({ config: null, changes: [] });
  });
});
