import path from "node:path";
import { ensureMediaDir, saveMediaBuffer } from "../../media/store.js";
import {
  DEFAULT_BROWSER_SCREENSHOT_MAX_BYTES,
  DEFAULT_BROWSER_SCREENSHOT_MAX_SIDE,
  normalizeBrowserScreenshot,
} from "../screenshot.js";
import type { BrowserRouteContext } from "../server-context.types.js";
import { handleRouteError, readBody, resolveProfileContext } from "./agent.shared.js";
import {
  navigatePinchTabBrowserTab,
  pdfPinchTabBrowserTab,
  screenshotPinchTabBrowserTab,
  snapshotPinchTabBrowserTab,
} from "./pinchtab-backend.js";
import type { BrowserResponse, BrowserRouteRegistrar } from "./types.js";
import { jsonError, toBoolean, toStringOrEmpty } from "./utils.js";

async function saveNormalizedScreenshotResponse(params: {
  res: BrowserResponse;
  buffer: Buffer;
  type: "png" | "jpeg";
  targetId: string;
  url: string;
}) {
  const normalized = await normalizeBrowserScreenshot(params.buffer, {
    maxSide: DEFAULT_BROWSER_SCREENSHOT_MAX_SIDE,
    maxBytes: DEFAULT_BROWSER_SCREENSHOT_MAX_BYTES,
  });
  await saveBrowserMediaResponse({
    res: params.res,
    buffer: normalized.buffer,
    contentType: normalized.contentType ?? `image/${params.type}`,
    maxBytes: DEFAULT_BROWSER_SCREENSHOT_MAX_BYTES,
    targetId: params.targetId,
    url: params.url,
  });
}

async function saveBrowserMediaResponse(params: {
  res: BrowserResponse;
  buffer: Buffer;
  contentType: string;
  maxBytes: number;
  targetId: string;
  url: string;
}) {
  await ensureMediaDir();
  const saved = await saveMediaBuffer(
    params.buffer,
    params.contentType,
    "browser",
    params.maxBytes,
  );
  params.res.json({
    ok: true,
    path: path.resolve(saved.path),
    targetId: params.targetId,
    url: params.url,
  });
}

export function registerBrowserAgentSnapshotRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.post("/navigate", async (req, res) => {
    const body = readBody(req);
    const url = toStringOrEmpty(body.url);
    const targetId = toStringOrEmpty(body.targetId) || undefined;
    if (!url) {
      return jsonError(res, 400, "url is required");
    }
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      res.json(await navigatePinchTabBrowserTab(profileCtx.profile.name, url, targetId));
    } catch (err) {
      handleRouteError(ctx, res, err);
    }
  });

  app.post("/pdf", async (req, res) => {
    const body = readBody(req);
    const targetId = toStringOrEmpty(body.targetId) || undefined;
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      const pdf = await pdfPinchTabBrowserTab(profileCtx.profile.name, targetId);
      await saveBrowserMediaResponse({
        res,
        buffer: pdf.buffer,
        contentType: "application/pdf",
        maxBytes: pdf.buffer.byteLength,
        targetId: pdf.targetId,
        url: pdf.url,
      });
    } catch (err) {
      handleRouteError(ctx, res, err);
    }
  });

  app.post("/screenshot", async (req, res) => {
    const body = readBody(req);
    const targetId = toStringOrEmpty(body.targetId) || undefined;
    const fullPage = toBoolean(body.fullPage) ?? false;
    const ref = toStringOrEmpty(body.ref) || undefined;
    const element = toStringOrEmpty(body.element) || undefined;
    const type = body.type === "jpeg" ? "jpeg" : "png";
    if (fullPage && (ref || element)) {
      return jsonError(res, 400, "fullPage is not supported for element screenshots");
    }
    if (ref || element || fullPage) {
      return jsonError(
        res,
        501,
        "PinchTab unified backend currently supports page screenshots only for the browser server.",
      );
    }
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      const screenshot = await screenshotPinchTabBrowserTab(profileCtx.profile.name, targetId);
      await saveNormalizedScreenshotResponse({
        res,
        buffer: screenshot.buffer,
        type,
        targetId: screenshot.targetId,
        url: screenshot.url,
      });
    } catch (err) {
      handleRouteError(ctx, res, err);
    }
  });

  app.get("/snapshot", async (req, res) => {
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    const targetId = typeof req.query.targetId === "string" ? req.query.targetId.trim() : "";
    const format = req.query.format === "aria" ? "aria" : "ai";
    if (req.query.labels || req.query.mode === "efficient") {
      return jsonError(
        res,
        501,
        "PinchTab unified backend does not support labels or mode=efficient on browser server snapshots yet.",
      );
    }
    try {
      res.json(
        await snapshotPinchTabBrowserTab(profileCtx.profile.name, {
          targetId: targetId || undefined,
          format,
        }),
      );
    } catch (err) {
      handleRouteError(ctx, res, err);
    }
  });
}
