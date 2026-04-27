import { afterEach, describe, expect, it, vi } from "vitest";
import { __testing, createPinchTabClient } from "./pinchtab-client.js";

afterEach(() => {
  __testing.setDepsForTest(null);
});

describe("PinchTab client", () => {
  it("decodes JSON base64 screenshot payloads", async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
    __testing.setDepsForTest({
      fetchImpl: vi.fn(async () => {
        return new Response(JSON.stringify({ base64: jpeg.toString("base64") }), {
          headers: { "content-type": "application/json" },
        });
      }),
    });

    const client = createPinchTabClient({ baseUrl: "http://pinchtab.test", token: "secret" });

    await expect(client.getScreenshot("tab-1")).resolves.toEqual(jpeg);
  });
});
