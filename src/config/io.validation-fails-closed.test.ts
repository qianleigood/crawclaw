import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot, loadConfig } from "./config.js";
import { withTempHomeConfig } from "./test-helpers.js";

describe("config validation fail-closed behavior", () => {
  beforeEach(() => {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    vi.restoreAllMocks();
  });

  it("throws INVALID_CONFIG instead of returning an empty config", async () => {
    await withTempHomeConfig(
      {
        agents: { list: [{ id: "main" }] },
        nope: true,
        gateway: { mode: "local" },
      },
      async () => {
        const spy = vi.spyOn(console, "error").mockImplementation(() => {});
        let thrown: unknown;
        try {
          loadConfig();
        } catch (err) {
          thrown = err;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as { code?: string } | undefined)?.code).toBe("INVALID_CONFIG");
        expect(spy).toHaveBeenCalled();
      },
    );
  });

  it("still loads valid gateway settings unchanged", async () => {
    await withTempHomeConfig(
      {
        agents: { list: [{ id: "main" }] },
        gateway: { mode: "local" },
      },
      async () => {
        const cfg = loadConfig();
        expect(cfg.gateway?.mode).toBe("local");
      },
    );
  });
});
