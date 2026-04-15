import { describe, expect, it } from "vitest";
import {
  closeActiveMemorySearchManagers,
  getActiveMemorySearchManager,
  resolveActiveMemoryBackendConfig,
} from "./memory-runtime.js";

describe("memory runtime", () => {
  it("returns unsupported for legacy local memory search", async () => {
    await expect(
      getActiveMemorySearchManager({
        cfg: {} as never,
        agentId: "main",
      }),
    ).resolves.toEqual({
      manager: null,
      error: "legacy local memory search is no longer supported",
    });
  });

  it("does not resolve a legacy local memory backend", () => {
    expect(resolveActiveMemoryBackendConfig({ cfg: {} as never, agentId: "main" })).toBeNull();
  });

  it("closes as a no-op", async () => {
    await expect(closeActiveMemorySearchManagers()).resolves.toBeUndefined();
  });
});
