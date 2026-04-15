import { BrowserTabNotFoundError } from "../errors.js";
import {
  assertBrowserNavigationAllowed,
  withBrowserNavigationPolicy,
} from "../navigation-guard.js";
import type { BrowserRouteContext } from "../server-context.types.js";
import {
  closePinchTabBrowserTab,
  focusPinchTabBrowserTab,
  listPinchTabBrowserTabs,
  openPinchTabBrowserTab,
} from "./pinchtab-backend.js";
import type { BrowserRequest, BrowserResponse, BrowserRouteRegistrar } from "./types.js";
import { getProfileContext, jsonError, toNumber, toStringOrEmpty } from "./utils.js";

function resolveTabsProfileContext(
  req: BrowserRequest,
  res: BrowserResponse,
  ctx: BrowserRouteContext,
) {
  const profileCtx = getProfileContext(req, ctx);
  if ("error" in profileCtx) {
    jsonError(res, profileCtx.status, profileCtx.error);
    return null;
  }
  return profileCtx;
}

function handleTabsRouteError(_ctx: BrowserRouteContext, res: BrowserResponse, err: unknown) {
  return jsonError(res, 500, String(err));
}

async function withTabsProfileRoute(params: {
  req: BrowserRequest;
  res: BrowserResponse;
  ctx: BrowserRouteContext;
  run: (profileName: string) => Promise<void>;
}) {
  const profileCtx = resolveTabsProfileContext(params.req, params.res, params.ctx);
  if (!profileCtx) {
    return;
  }
  try {
    await params.run(profileCtx.profile.name);
  } catch (err) {
    handleTabsRouteError(params.ctx, params.res, err);
  }
}

function resolveIndexedTab(tabs: Array<{ targetId: string }>, index: number | undefined) {
  return typeof index === "number" ? tabs[index] : tabs.at(0);
}

function parseRequiredTargetId(res: BrowserResponse, rawTargetId: unknown): string | null {
  const targetId = toStringOrEmpty(rawTargetId);
  if (!targetId) {
    jsonError(res, 400, "targetId is required");
    return null;
  }
  return targetId;
}

async function runTabTargetMutation(params: {
  req: BrowserRequest;
  res: BrowserResponse;
  ctx: BrowserRouteContext;
  targetId: string;
  mutate: (profileName: string, targetId: string) => Promise<void>;
}) {
  await withTabsProfileRoute({
    req: params.req,
    res: params.res,
    ctx: params.ctx,
    run: async (profileName) => {
      await params.mutate(profileName, params.targetId);
      params.res.json({ ok: true });
    },
  });
}

export function registerBrowserTabRoutes(app: BrowserRouteRegistrar, ctx: BrowserRouteContext) {
  app.get("/tabs", async (req, res) => {
    await withTabsProfileRoute({
      req,
      res,
      ctx,
      run: async (profileName) => {
        const tabs = await listPinchTabBrowserTabs(profileName);
        res.json({ running: tabs.running, tabs: tabs.tabs });
      },
    });
  });

  app.post("/tabs/open", async (req, res) => {
    const url = toStringOrEmpty((req.body as { url?: unknown })?.url);
    if (!url) {
      return jsonError(res, 400, "url is required");
    }

    await withTabsProfileRoute({
      req,
      res,
      ctx,
      run: async (profileName) => {
        await assertBrowserNavigationAllowed({
          url,
          ...withBrowserNavigationPolicy(ctx.state().resolved.ssrfPolicy),
        });
        const tab = await openPinchTabBrowserTab(profileName, url);
        res.json(tab);
      },
    });
  });

  app.post("/tabs/focus", async (req, res) => {
    const targetId = parseRequiredTargetId(res, (req.body as { targetId?: unknown })?.targetId);
    if (!targetId) {
      return;
    }
    await runTabTargetMutation({
      req,
      res,
      ctx,
      targetId,
      mutate: async (profileName, id) => {
        await focusPinchTabBrowserTab(profileName, id);
      },
    });
  });

  app.delete("/tabs/:targetId", async (req, res) => {
    const targetId = parseRequiredTargetId(res, req.params.targetId);
    if (!targetId) {
      return;
    }
    await runTabTargetMutation({
      req,
      res,
      ctx,
      targetId,
      mutate: async (profileName, id) => {
        await closePinchTabBrowserTab(profileName, id);
      },
    });
  });

  app.post("/tabs/action", async (req, res) => {
    const action = toStringOrEmpty((req.body as { action?: unknown })?.action);
    const index = toNumber((req.body as { index?: unknown })?.index);

    await withTabsProfileRoute({
      req,
      res,
      ctx,
      run: async (profileName) => {
        if (action === "list") {
          const tabs = await listPinchTabBrowserTabs(profileName);
          return res.json({ ok: true, tabs: tabs.tabs });
        }

        if (action === "new") {
          const tab = await openPinchTabBrowserTab(profileName, "about:blank");
          return res.json({ ok: true, tab });
        }

        if (action === "close") {
          const tabs = await listPinchTabBrowserTabs(profileName);
          const target = resolveIndexedTab(tabs.tabs, index);
          if (!target) {
            throw new BrowserTabNotFoundError();
          }
          await closePinchTabBrowserTab(profileName, target.targetId);
          return res.json({ ok: true, targetId: target.targetId });
        }

        if (action === "select") {
          if (typeof index !== "number") {
            return jsonError(res, 400, "index is required");
          }
          const tabs = await listPinchTabBrowserTabs(profileName);
          const target = tabs.tabs[index];
          if (!target) {
            throw new BrowserTabNotFoundError();
          }
          await focusPinchTabBrowserTab(profileName, target.targetId);
          return res.json({ ok: true, targetId: target.targetId });
        }

        return jsonError(res, 400, "unknown tab action");
      },
    });
  });
}
