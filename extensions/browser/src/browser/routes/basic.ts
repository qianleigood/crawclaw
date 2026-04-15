import { createBrowserProfilesService } from "../profiles-service.js";
import type { BrowserRouteContext } from "../server-context.types.js";
import {
  getPinchTabBrowserStatus,
  listPinchTabProfiles,
  startPinchTabBrowser,
  stopPinchTabBrowser,
} from "./pinchtab-backend.js";
import type { BrowserRequest, BrowserResponse, BrowserRouteRegistrar } from "./types.js";
import { getProfileContext, jsonError, toStringOrEmpty } from "./utils.js";

function handleBrowserRouteError(res: BrowserResponse, err: unknown) {
  jsonError(res, 500, String(err));
}

async function withProfilesServiceMutation(params: {
  res: BrowserResponse;
  ctx: BrowserRouteContext;
  run: (service: ReturnType<typeof createBrowserProfilesService>) => Promise<unknown>;
}) {
  try {
    const service = createBrowserProfilesService(params.ctx);
    const result = await params.run(service);
    params.res.json(result);
  } catch (err) {
    return handleBrowserRouteError(params.res, err);
  }
}

export function registerBrowserBasicRoutes(app: BrowserRouteRegistrar, ctx: BrowserRouteContext) {
  // List all profiles with their status
  app.get("/profiles", async (_req, res) => {
    try {
      const profiles = await listPinchTabProfiles(ctx);
      res.json({ profiles });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  // Get status (profile-aware)
  app.get("/", async (req, res) => {
    let current: ReturnType<typeof ctx.state>;
    try {
      current = ctx.state();
    } catch {
      return jsonError(res, 503, "browser server not started");
    }

    const profileCtx = getProfileContext(req, ctx);
    if ("error" in profileCtx) {
      return jsonError(res, profileCtx.status, profileCtx.error);
    }

    try {
      res.json(await getPinchTabBrowserStatus(ctx, profileCtx.profile.name));
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  // Start browser (profile-aware)
  app.post("/start", async (req, res) => {
    const profileCtx = getProfileContext(req, ctx);
    if ("error" in profileCtx) {
      return jsonError(res, profileCtx.status, profileCtx.error);
    }
    try {
      res.json(await startPinchTabBrowser(profileCtx.profile.name));
    } catch (err) {
      handleBrowserRouteError(res, err);
    }
  });

  // Stop browser (profile-aware)
  app.post("/stop", async (req, res) => {
    const profileCtx = getProfileContext(req, ctx);
    if ("error" in profileCtx) {
      return jsonError(res, profileCtx.status, profileCtx.error);
    }
    try {
      res.json(await stopPinchTabBrowser(profileCtx.profile.name));
    } catch (err) {
      handleBrowserRouteError(res, err);
    }
  });

  // Reset profile (profile-aware)
  app.post("/reset-profile", async (req, res) => {
    const profileCtx = getProfileContext(req, ctx);
    if ("error" in profileCtx) {
      return jsonError(res, profileCtx.status, profileCtx.error);
    }
    try {
      await stopPinchTabBrowser(profileCtx.profile.name);
      res.json({
        ok: true,
        profile: profileCtx.profile.name,
        moved: false,
        from: "pinchtab-session",
      });
    } catch (err) {
      handleBrowserRouteError(res, err);
    }
  });

  // Create a new profile
  app.post("/profiles/create", async (req, res) => {
    const name = toStringOrEmpty((req.body as { name?: unknown })?.name);
    const color = toStringOrEmpty((req.body as { color?: unknown })?.color);

    if (!name) {
      return jsonError(res, 400, "name is required");
    }

    await withProfilesServiceMutation({
      res,
      ctx,
      run: async (service) =>
        await service.createProfile({
          name,
          color: color || undefined,
        }),
    });
  });

  // Delete a profile
  app.delete("/profiles/:name", async (req, res) => {
    const name = toStringOrEmpty(req.params.name);
    if (!name) {
      return jsonError(res, 400, "profile name is required");
    }

    await withProfilesServiceMutation({
      res,
      ctx,
      run: async (service) => await service.deleteProfile(name),
    });
  });
}
