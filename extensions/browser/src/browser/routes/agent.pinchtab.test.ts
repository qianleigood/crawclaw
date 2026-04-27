import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { __testing as pinchTabClientTesting } from "../../pinchtab/pinchtab-client.js";
import { __testing as pinchTabStateTesting } from "../../pinchtab/pinchtab-state.js";
import { registerBrowserAgentRoutes } from "./agent.js";
import { createBrowserRouteApp, createBrowserRouteResponse } from "./test-helpers.js";

const mediaStoreMocks = vi.hoisted(() => ({
  saveMediaBuffer: vi.fn(
    async (_buffer: Buffer, _contentType: string | undefined, _scope: string) => ({
      path: "/tmp/pinchtab-output.bin",
    }),
  ),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({
    browser: {
      pinchtab: {
        baseUrl: "http://pinchtab.test",
        token: "secret",
      },
    },
  }),
}));

vi.mock("../navigation-guard.js", () => ({
  assertBrowserNavigationAllowed: async () => {},
  assertBrowserNavigationResultAllowed: async () => {},
  withBrowserNavigationPolicy: () => ({}),
}));

vi.mock("../../media/store.js", () => ({
  ensureMediaDir: async () => {},
  saveMediaBuffer: mediaStoreMocks.saveMediaBuffer,
}));

function createCtx() {
  return {
    state: () => ({
      resolved: {
        evaluateEnabled: true,
        ssrfPolicy: {},
      },
    }),
    forProfile: (profileName?: string) =>
      ({
        profile: {
          name: profileName?.trim() || "browser",
          color: "#FF4500",
          cdpUrl: "",
        },
      }) as never,
  };
}

async function callRoute(params: {
  method: "get" | "post";
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}) {
  const { app, getHandlers, postHandlers } = createBrowserRouteApp();
  registerBrowserAgentRoutes(app, createCtx() as never);
  const handlers = params.method === "get" ? getHandlers : postHandlers;
  const handler = handlers.get(params.path);
  expect(handler).toBeTypeOf("function");
  const response = createBrowserRouteResponse();
  await handler?.(
    {
      params: params.params ?? {},
      query: params.query ?? { profile: "browser" },
      body: params.body,
    },
    response.res,
  );
  return response;
}

function buildJsonResponse(payload: unknown) {
  return {
    ok: true,
    text: async () => JSON.stringify(payload),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  } as Response;
}

beforeAll(async () => {
  await import("./agent.js");
});

afterEach(() => {
  pinchTabStateTesting.reset();
  pinchTabClientTesting.setDepsForTest(null);
  mediaStoreMocks.saveMediaBuffer.mockClear();
});

describe("agent routes PinchTab backend", () => {
  it("serves navigate, snapshot, screenshot, and pdf through pinchtab", async () => {
    const tabs = [{ id: "tab-1", title: "Example", url: "https://example.com", type: "page" }];
    pinchTabStateTesting.reset();
    pinchTabClientTesting.setDepsForTest({
      fetchImpl: vi.fn(async (url, init) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && String(url).endsWith("/profiles?all=true")) {
          return buildJsonResponse([{ id: "profile-browser", name: "browser" }]);
        }
        if (method === "POST" && String(url).endsWith("/instances/start")) {
          return buildJsonResponse({ id: "instance-1" });
        }
        if (method === "GET" && String(url).endsWith("/instances/instance-1/tabs")) {
          return buildJsonResponse(tabs);
        }
        if (method === "POST" && String(url).endsWith("/tabs/tab-1/action")) {
          return buildJsonResponse({ ok: true });
        }
        if (method === "GET" && String(url).endsWith("/tabs/tab-1/snapshot")) {
          return buildJsonResponse({ snapshot: "ok", refs: { e1: { role: "button" } } });
        }
        if (method === "GET" && String(url).endsWith("/tabs/tab-1/screenshot")) {
          return buildJsonResponse({});
        }
        if (method === "GET" && String(url).endsWith("/tabs/tab-1/pdf")) {
          return buildJsonResponse({});
        }
        throw new Error(`unexpected request: ${method} ${String(url)}`);
      }),
    });

    const navigated = await callRoute({
      method: "post",
      path: "/navigate",
      body: { url: "https://example.com", profile: "browser" },
    });
    expect(navigated.body).toMatchObject({
      ok: true,
      targetId: "tab-1",
      url: "https://example.com",
    });

    const snapshot = await callRoute({
      method: "get",
      path: "/snapshot",
      query: { profile: "browser", format: "ai" },
    });
    expect(snapshot.body).toMatchObject({
      ok: true,
      format: "ai",
      targetId: "tab-1",
      snapshot: "ok",
    });

    const screenshot = await callRoute({
      method: "post",
      path: "/screenshot",
      body: { profile: "browser" },
    });
    expect(screenshot.body).toMatchObject({
      ok: true,
      path: "/tmp/pinchtab-output.bin",
      targetId: "tab-1",
    });

    const pdf = await callRoute({
      method: "post",
      path: "/pdf",
      body: { profile: "browser" },
    });
    expect(pdf.body).toMatchObject({
      ok: true,
      path: "/tmp/pinchtab-output.bin",
      targetId: "tab-1",
    });
  });

  it("decodes PinchTab JSON screenshot payloads before saving media", async () => {
    const tabs = [{ id: "tab-1", title: "Example", url: "https://example.com", type: "page" }];
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
    pinchTabStateTesting.reset();
    pinchTabClientTesting.setDepsForTest({
      fetchImpl: vi.fn(async (url, init) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && String(url).endsWith("/profiles?all=true")) {
          return buildJsonResponse([{ id: "profile-browser", name: "browser" }]);
        }
        if (method === "POST" && String(url).endsWith("/instances/start")) {
          return buildJsonResponse({ id: "instance-1" });
        }
        if (method === "GET" && String(url).endsWith("/instances/instance-1/tabs")) {
          return buildJsonResponse(tabs);
        }
        if (method === "GET" && String(url).endsWith("/tabs/tab-1/screenshot")) {
          return new Response(JSON.stringify({ base64: jpeg.toString("base64") }), {
            headers: { "content-type": "application/json" },
          });
        }
        throw new Error(`unexpected request: ${method} ${String(url)}`);
      }),
    });

    const screenshot = await callRoute({
      method: "post",
      path: "/screenshot",
      body: { profile: "browser" },
    });

    expect(screenshot.statusCode).toBe(200);
    expect(mediaStoreMocks.saveMediaBuffer).toHaveBeenCalledTimes(1);
    const [savedBuffer, contentType] = mediaStoreMocks.saveMediaBuffer.mock.calls[0] ?? [];
    expect(savedBuffer).toEqual(jpeg);
    expect(contentType).toBeUndefined();
  });

  it("serves basic act requests through pinchtab", async () => {
    const tabs = [{ id: "tab-1", title: "Example", url: "https://example.com", type: "page" }];
    pinchTabClientTesting.setDepsForTest({
      fetchImpl: vi.fn(async (url, init) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && String(url).endsWith("/profiles?all=true")) {
          return buildJsonResponse([{ id: "profile-browser", name: "browser" }]);
        }
        if (method === "POST" && String(url).endsWith("/instances/start")) {
          return buildJsonResponse({ id: "instance-1" });
        }
        if (method === "GET" && String(url).endsWith("/instances/instance-1/tabs")) {
          return buildJsonResponse(tabs);
        }
        if (method === "POST" && String(url).endsWith("/tabs/tab-1/action")) {
          return buildJsonResponse({ ok: true });
        }
        throw new Error(`unexpected request: ${method} ${String(url)}`);
      }),
    });

    const clicked = await callRoute({
      method: "post",
      path: "/act",
      body: { profile: "browser", kind: "click", ref: "e1" },
    });
    expect(clicked.body).toMatchObject({ ok: true, targetId: "tab-1" });

    const typed = await callRoute({
      method: "post",
      path: "/act",
      body: { profile: "browser", kind: "type", ref: "e1", text: "hello" },
    });
    expect(typed.body).toMatchObject({ ok: true, targetId: "tab-1" });

    const pressed = await callRoute({
      method: "post",
      path: "/act",
      body: { profile: "browser", kind: "press", key: "Enter" },
    });
    expect(pressed.body).toMatchObject({ ok: true, targetId: "tab-1" });
  });

  it("serves debug, storage, hooks, and downloads through pinchtab-compatible routes", async () => {
    const tabs = [{ id: "tab-1", title: "Example", url: "https://example.com", type: "page" }];
    pinchTabClientTesting.setDepsForTest({
      fetchImpl: vi.fn(async (url, init) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && String(url).endsWith("/profiles?all=true")) {
          return buildJsonResponse([{ id: "profile-browser", name: "browser" }]);
        }
        if (method === "POST" && String(url).endsWith("/instances/start")) {
          return buildJsonResponse({ id: "instance-1" });
        }
        if (method === "GET" && String(url).endsWith("/instances/instance-1/tabs")) {
          return buildJsonResponse(tabs);
        }
        if (method === "GET" && String(url).endsWith("/tabs/tab-1/cookies")) {
          return buildJsonResponse({ cookies: [{ name: "sid", value: "abc" }] });
        }
        if (method === "POST" && String(url).endsWith("/instances/instance-1/evaluate")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { expression?: string };
          if (body.expression?.includes("performance.getEntriesByType")) {
            return buildJsonResponse({
              result: JSON.stringify({
                entries: [{ name: "https://example.com/api", duration: 1 }],
              }),
            });
          }
          if (body.expression?.includes("window.localStorage")) {
            return buildJsonResponse({
              result: JSON.stringify({ kind: "local", values: { token: "xyz" } }),
            });
          }
          if (body.expression?.includes("window.location.href")) {
            return buildJsonResponse({
              result: JSON.stringify({
                ok: true,
                url: "https://example.com",
                status: 200,
                base64: Buffer.from("hello").toString("base64"),
              }),
            });
          }
          return buildJsonResponse({ result: JSON.stringify({ messages: [] }) });
        }
        if (method === "POST" && String(url).endsWith("/tabs/tab-1/action")) {
          return buildJsonResponse({ ok: true });
        }
        throw new Error(`unexpected request: ${method} ${String(url)}`);
      }),
    });

    const requests = await callRoute({
      method: "get",
      path: "/requests",
      query: { profile: "browser" },
    });
    expect(requests.body).toMatchObject({
      ok: true,
      targetId: "tab-1",
      entries: [{ name: "https://example.com/api" }],
    });

    const cookies = await callRoute({
      method: "get",
      path: "/cookies",
      query: { profile: "browser" },
    });
    expect(cookies.body).toMatchObject({
      ok: true,
      targetId: "tab-1",
      cookies: [{ name: "sid", value: "abc" }],
    });

    const storage = await callRoute({
      method: "get",
      path: "/storage/:kind",
      query: { profile: "browser" },
      params: { kind: "local" } as never,
    } as never);
    expect(storage.body).toMatchObject({
      ok: true,
      targetId: "tab-1",
      kind: "local",
      values: { token: "xyz" },
    });

    const hook = await callRoute({
      method: "post",
      path: "/hooks/dialog",
      body: { profile: "browser", accept: true },
    });
    expect(hook.body).toMatchObject({ ok: true, targetId: "tab-1" });

    const download = await callRoute({
      method: "post",
      path: "/wait/download",
      body: { profile: "browser", path: "download.bin" },
    });
    expect(download.body).toMatchObject({ ok: true, targetId: "tab-1" });
  });
});
