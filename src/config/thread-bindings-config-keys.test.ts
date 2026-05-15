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
});
