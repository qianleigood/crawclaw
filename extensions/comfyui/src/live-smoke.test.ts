import { describe, expect, it } from "vitest";
import { normalizeNodeCatalog } from "./catalog.js";
import { ComfyUiClient } from "./client.js";

const liveEnabled = process.env.CRAWCLAW_COMFYUI_LIVE_TEST === "1";

describe.skipIf(!liveEnabled)("ComfyUI live smoke", () => {
  it("can inspect a local ComfyUI catalog", async () => {
    const client = new ComfyUiClient({
      baseUrl: process.env.CRAWCLAW_COMFYUI_BASE_URL ?? "http://127.0.0.1:8188",
      requestTimeoutMs: 5000,
    });

    const catalog = normalizeNodeCatalog(await client.getObjectInfo());

    expect(catalog.nodes.length).toBeGreaterThan(0);
  });
});
