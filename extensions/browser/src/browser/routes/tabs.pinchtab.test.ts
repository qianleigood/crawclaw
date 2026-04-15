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

vi.mock("../navigation-guard.js", () => ({
  assertBrowserNavigationAllowed: async () => {},
  withBrowserNavigationPolicy: () => ({}),
}));

let registerBrowserTabRoutes: typeof import("./tabs.js").registerBrowserTabRoutes;

type TabRecord = {
  id: string;
  title: string;
  url: string;
  type?: string;
};

function createState() {
  return {
    resolved: {
      ssrfPolicy: {},
    },
    forProfile: (profileName?: string) =>
      ({
        profile: {
          name: profileName?.trim() || "browser",
          color: "#FF4500",
        },
      }) as never,
  };
}

function buildJsonResponse(payload: unknown) {
  return {
    ok: true,
    text: async () => JSON.stringify(payload),
  } as Response;
}

async function callRoute(params: {
  method: "get" | "post" | "delete";
  path: string;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
}) {
  const { app, getHandlers, postHandlers, deleteHandlers } = createBrowserRouteApp();
  const state = createState();
  registerBrowserTabRoutes(app, {
    state: () => state,
    forProfile: state.forProfile,
    mapTabError: () => null,
  } as never);
  const handlers =
    params.method === "get"
      ? getHandlers
      : params.method === "post"
        ? postHandlers
        : deleteHandlers;
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

beforeAll(async () => {
  ({ registerBrowserTabRoutes } = await import("./tabs.js"));
});

afterEach(() => {
  pinchTabStateTesting.reset();
  pinchTabClientTesting.setDepsForTest(null);
});

describe("tab routes PinchTab backend", () => {
  it("lists, opens, focuses, and closes tabs via pinchtab", async () => {
    const tabs: TabRecord[] = [];
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
        if (method === "POST" && String(url).endsWith("/instances/instance-1/tabs/open")) {
          const body = JSON.parse(String(init?.body ?? "{}")) as { url?: string };
          const opened = {
            id: `tab-${tabs.length + 1}`,
            title: "Opened",
            url: body.url ?? "about:blank",
            type: "page",
          };
          tabs.push(opened);
          return buildJsonResponse(opened);
        }
        if (method === "DELETE" && String(url).includes("/tabs/")) {
          const targetId = decodeURIComponent(String(url).split("/tabs/")[1] ?? "");
          const index = tabs.findIndex((tab) => tab.id === targetId);
          if (index >= 0) {
            tabs.splice(index, 1);
          }
          return buildJsonResponse({ ok: true });
        }
        throw new Error(`unexpected request: ${method} ${String(url)}`);
      }),
    });

    const listedEmpty = await callRoute({
      method: "get",
      path: "/tabs",
    });
    expect(listedEmpty.body).toMatchObject({ running: false, tabs: [] });

    const opened = await callRoute({
      method: "post",
      path: "/tabs/open",
      body: { url: "https://example.com", profile: "browser" },
    });
    expect(opened.body).toMatchObject({
      targetId: "tab-1",
      title: "Opened",
      url: "https://example.com",
    });

    const listed = await callRoute({
      method: "get",
      path: "/tabs",
    });
    expect(listed.body).toMatchObject({
      running: true,
      tabs: [{ targetId: "tab-1", url: "https://example.com" }],
    });

    const focused = await callRoute({
      method: "post",
      path: "/tabs/focus",
      body: { targetId: "tab-1", profile: "browser" },
    });
    expect(focused.body).toMatchObject({ ok: true });

    const closed = await callRoute({
      method: "delete",
      path: "/tabs/:targetId",
      params: { targetId: "tab-1" },
      query: { profile: "browser" },
    });
    expect(closed.body).toMatchObject({ ok: true });

    const listedAfterClose = await callRoute({
      method: "get",
      path: "/tabs",
    });
    expect(listedAfterClose.body).toMatchObject({ running: true, tabs: [] });
  });
});
