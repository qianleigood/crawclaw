import type { BrowserRouteContext } from "../server-context.types.js";
import { readBody, resolveProfileContext } from "./agent.shared.js";
import { evaluatePinchTabBrowserInstance } from "./pinchtab-backend.js";
import type { BrowserRouteRegistrar } from "./types.js";
import { jsonError, toBoolean, toStringOrEmpty } from "./utils.js";

export function registerBrowserAgentDebugRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.get("/console", async (req, res) => {
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    const level = typeof req.query.level === "string" ? req.query.level.trim() : "";
    try {
      const result = await evaluatePinchTabBrowserInstance<{ messages?: unknown[] }>(
        profileCtx.profile.name,
        `JSON.stringify({ messages: [] })`,
        typeof req.query.targetId === "string" ? req.query.targetId.trim() || undefined : undefined,
      );
      const messages = Array.isArray(result.value?.messages) ? result.value.messages : [];
      res.json({
        ok: true,
        targetId: result.targetId,
        messages:
          level === "error"
            ? messages.filter(
                (entry) =>
                  entry &&
                  typeof entry === "object" &&
                  (entry as { level?: unknown }).level === "error",
              )
            : messages,
      });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.get("/errors", async (req, res) => {
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    const clear = toBoolean(req.query.clear) ?? false;
    try {
      const result = await evaluatePinchTabBrowserInstance<{ errors?: unknown[] }>(
        profileCtx.profile.name,
        `JSON.stringify({ errors: [] })`,
        typeof req.query.targetId === "string" ? req.query.targetId.trim() || undefined : undefined,
      );
      res.json({
        ok: true,
        targetId: result.targetId,
        errors: Array.isArray(result.value?.errors) ? result.value.errors : [],
        cleared: clear,
      });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.get("/requests", async (req, res) => {
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    const filter = typeof req.query.filter === "string" ? req.query.filter.trim() : "";
    const clear = toBoolean(req.query.clear) ?? false;
    const limitExpr = filter ? 100 : 100;
    try {
      const result = await evaluatePinchTabBrowserInstance<{ entries?: unknown[] }>(
        profileCtx.profile.name,
        `JSON.stringify((() => ({ entries: performance.getEntriesByType("resource").slice(-${limitExpr}).map((entry) => ({ name: entry.name, initiatorType: entry.initiatorType, duration: entry.duration })) }))())`,
        typeof req.query.targetId === "string" ? req.query.targetId.trim() || undefined : undefined,
      );
      const entries = Array.isArray(result.value?.entries) ? result.value.entries : [];
      res.json({
        ok: true,
        targetId: result.targetId,
        entries: filter
          ? entries.filter(
              (entry) =>
                entry &&
                typeof entry === "object" &&
                String((entry as { name?: unknown }).name ?? "").includes(filter),
            )
          : entries,
        cleared: clear,
      });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.post("/trace/start", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support trace start on browser server yet.",
    );
  });

  app.post("/trace/stop", async (req, res) => {
    const body = readBody(req);
    const out = toStringOrEmpty(body.path) || "";
    jsonError(
      res,
      501,
      out
        ? "PinchTab unified backend does not support trace stop on browser server yet."
        : "PinchTab unified backend does not support tracing on browser server yet.",
    );
  });
}
