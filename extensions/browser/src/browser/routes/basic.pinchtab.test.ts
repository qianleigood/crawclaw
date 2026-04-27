import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { __testing as pinchTabClientTesting } from "../../pinchtab/pinchtab-client.js";
import { __testing as pinchTabStateTesting } from "../../pinchtab/pinchtab-state.js";
import { createBrowserRouteApp, createBrowserRouteResponse } from "./test-helpers.js";

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

let registerBrowserBasicRoutes: typeof import("./basic.js").registerBrowserBasicRoutes;

type FetchResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  text: () => Promise<string>;
};

function createState() {
  return {
    resolved: {
      enabled: true,
      headless: false,
      noSandbox: false,
    },
    profiles: new Map(),
    forProfile: (profileName?: string) =>
      ({
        profile: {
          name: profileName?.trim() || "browser",
          color: "#FF4500",
        },
      }) as never,
    listProfiles: async () => [
      {
        name: "browser",
        transport: "cdp",
        cdpPort: 19002,
        cdpUrl: "http://127.0.0.1:19002",
        color: "#FF4500",
        driver: "crawclaw",
        running: false,
        tabCount: 0,
        isDefault: true,
        isRemote: false,
      },
    ],
  };
}

function buildJsonResponse(payload: unknown): FetchResponse {
  return {
    ok: true,
    text: async () => JSON.stringify(payload),
  };
}

async function callRoute(params: {
  method: "get" | "post";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
}) {
  const { app, getHandlers, postHandlers } = createBrowserRouteApp();
  const state = createState();
  registerBrowserBasicRoutes(app, {
    state: () => state,
    forProfile: state.forProfile,
    listProfiles: state.listProfiles,
  } as never);
  const handlers = params.method === "get" ? getHandlers : postHandlers;
  const handler = handlers.get(params.path);
  expect(handler).toBeTypeOf("function");
  const response = createBrowserRouteResponse();
  await handler?.(
    {
      params: {},
      query: params.query ?? { profile: "browser" },
      body: params.body,
    },
    response.res,
  );
  return response;
}

beforeAll(async () => {
  ({ registerBrowserBasicRoutes } = await import("./basic.js"));
});

afterEach(() => {
  pinchTabStateTesting.reset();
  pinchTabClientTesting.setDepsForTest(null);
});

describe("basic browser routes PinchTab backend", () => {
  it("reports pinchtab status without legacy CDP fields", async () => {
    const response = await callRoute({
      method: "get",
      path: "/",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      profile: "browser",
      driver: "crawclaw",
      transport: "pinchtab",
      running: false,
      cdpPort: null,
      cdpUrl: null,
      chosenBrowser: null,
      detectedBrowser: "pinchtab",
    });
  });

  it("starts and stops a pinchtab runtime", async () => {
    pinchTabClientTesting.setDepsForTest({
      fetchImpl: vi.fn(async (url, init) => {
        const method = init?.method ?? "GET";
        if (method === "GET" && String(url).endsWith("/profiles?all=true")) {
          return buildJsonResponse([{ id: "profile-browser", name: "browser" }]) as Response;
        }
        if (method === "POST" && String(url).endsWith("/instances/start")) {
          return buildJsonResponse({ id: "instance-1" }) as Response;
        }
        if (method === "GET" && String(url).endsWith("/instances/instance-1/tabs")) {
          return buildJsonResponse([]) as Response;
        }
        if (method === "POST" && String(url).endsWith("/instances/instance-1/stop")) {
          return buildJsonResponse({ ok: true }) as Response;
        }
        throw new Error(`unexpected request: ${method} ${String(url)}`);
      }),
    });

    const started = await callRoute({
      method: "post",
      path: "/start",
      body: { profile: "browser" },
    });
    expect(started.statusCode).toBe(200);
    expect(started.body).toMatchObject({ ok: true, profile: "browser" });

    const running = await callRoute({
      method: "get",
      path: "/",
    });
    expect(running.body).toMatchObject({ running: true, chosenBrowser: "pinchtab" });

    const stopped = await callRoute({
      method: "post",
      path: "/stop",
      body: { profile: "browser" },
    });
    expect(stopped.statusCode).toBe(200);
    expect(stopped.body).toMatchObject({ ok: true, stopped: true, profile: "browser" });
  });
});
