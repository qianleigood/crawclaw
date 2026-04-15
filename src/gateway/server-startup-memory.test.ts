import { describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { startGatewayMemoryBackend } from "./server-startup-memory.js";

describe("startGatewayMemoryBackend", () => {
  it("is a no-op for legacy local memory search startup", async () => {
    const log = { info: vi.fn(), warn: vi.fn() };

    await expect(
      startGatewayMemoryBackend({ cfg: {} as CrawClawConfig, log }),
    ).resolves.toBeUndefined();

    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
