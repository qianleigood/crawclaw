import { describe, expect, it, vi } from "vitest";
import { ComfyUiClient, ComfyUiClientError } from "./client.js";

describe("ComfyUiClient", () => {
  it("fetches local ComfyUI object_info through the configured base URL", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ KSampler: {} })));
    const client = new ComfyUiClient({
      baseUrl: "http://127.0.0.1:8188",
      requestTimeoutMs: 1000,
      fetch,
    });

    await expect(client.getObjectInfo()).resolves.toEqual({ KSampler: {} });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8188/object_info",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("surfaces ComfyUI prompt validation node_errors", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: "invalid prompt", node_errors: { "7": { errors: ["bad"] } } }),
          { status: 400 },
        ),
    );
    const client = new ComfyUiClient({
      baseUrl: "http://127.0.0.1:8188",
      requestTimeoutMs: 1000,
      fetch,
    });

    await expect(client.submitPrompt({})).rejects.toMatchObject({
      name: "ComfyUiClientError",
      code: "comfyui_http_error",
      details: expect.objectContaining({ node_errors: { "7": { errors: ["bad"] } } }),
    } satisfies Partial<ComfyUiClientError>);
  });
});
