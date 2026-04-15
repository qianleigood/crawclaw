import type { BrowserActRequest } from "../client-actions-core.js";
import type { BrowserRouteContext } from "../server-context.types.js";
import { registerBrowserAgentActDownloadRoutes } from "./agent.act.download.js";
import { registerBrowserAgentActHookRoutes } from "./agent.act.hooks.js";
import { type ActKind, isActKind } from "./agent.act.shared.js";
import {
  handleRouteError,
  readBody,
  resolveTargetIdFromBody,
  SELECTOR_UNSUPPORTED_MESSAGE,
  resolveProfileContext,
} from "./agent.shared.js";
import { actPinchTabBrowserTab, evaluatePinchTabBrowserInstance } from "./pinchtab-backend.js";
import type { BrowserRouteRegistrar } from "./types.js";
import { jsonError, toBoolean, toStringArray, toStringOrEmpty } from "./utils.js";

function browserEvaluateDisabledMessage(action: "wait" | "evaluate"): string {
  return [
    action === "wait"
      ? "wait --fn is disabled by config (browser.evaluateEnabled=false)."
      : "act:evaluate is disabled by config (browser.evaluateEnabled=false).",
    "Docs: /gateway/configuration-reference#browser",
  ].join("\n");
}

const SELECTOR_ALLOWED_KINDS: ReadonlySet<string> = new Set(["click", "hover", "select", "type"]);

function unsupportedActMessage(kind: ActKind): string {
  return `PinchTab unified backend does not support act:${kind} on browser server yet.`;
}

export function registerBrowserAgentActRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.post("/act", async (req, res) => {
    const body = readBody(req);
    const kindRaw = toStringOrEmpty(body.kind);
    if (!isActKind(kindRaw)) {
      return jsonError(res, 400, "kind is required");
    }
    const kind: ActKind = kindRaw;
    const targetId = resolveTargetIdFromBody(body);
    if (Object.hasOwn(body, "selector") && !SELECTOR_ALLOWED_KINDS.has(kind)) {
      return jsonError(res, 400, SELECTOR_UNSUPPORTED_MESSAGE);
    }
    const earlyFn = kind === "wait" || kind === "evaluate" ? toStringOrEmpty(body.fn) : "";
    if (
      (kind === "evaluate" || (kind === "wait" && earlyFn)) &&
      !ctx.state().resolved.evaluateEnabled
    ) {
      return jsonError(
        res,
        403,
        browserEvaluateDisabledMessage(kind === "evaluate" ? "evaluate" : "wait"),
      );
    }
    if (Object.hasOwn(body, "selector")) {
      return jsonError(
        res,
        501,
        "PinchTab unified backend on browser server currently supports ref-based act requests only.",
      );
    }
    try {
      const profileCtx = resolveProfileContext(req, res, ctx);
      if (!profileCtx) {
        return;
      }
      switch (kind) {
        case "click":
          return res.json(
            await actPinchTabBrowserTab(
              profileCtx.profile.name,
              {
                kind,
                ref: toStringOrEmpty(body.ref) || undefined,
                targetId,
                doubleClick: toBoolean(body.doubleClick) ?? undefined,
              },
              targetId,
            ),
          );
        case "type":
          if (typeof body.text !== "string") {
            return jsonError(res, 400, "text is required");
          }
          return res.json(
            await actPinchTabBrowserTab(
              profileCtx.profile.name,
              { kind, ref: toStringOrEmpty(body.ref) || undefined, text: body.text, targetId },
              targetId,
            ),
          );
        case "press": {
          const key = toStringOrEmpty(body.key);
          if (!key) {
            return jsonError(res, 400, "key is required");
          }
          return res.json(
            await actPinchTabBrowserTab(profileCtx.profile.name, { kind, key, targetId }, targetId),
          );
        }
        case "hover":
          return res.json(
            await actPinchTabBrowserTab(
              profileCtx.profile.name,
              { kind, ref: toStringOrEmpty(body.ref) || undefined, targetId },
              targetId,
            ),
          );
        case "select": {
          const values = toStringArray(body.values) ?? [];
          if (!values.length) {
            return jsonError(res, 400, "values is required");
          }
          return res.json(
            await actPinchTabBrowserTab(
              profileCtx.profile.name,
              { kind, ref: toStringOrEmpty(body.ref) || undefined, values, targetId },
              targetId,
            ),
          );
        }
        case "fill": {
          const ref = toStringOrEmpty(body.ref);
          const text = typeof body.text === "string" ? body.text : undefined;
          if (!ref || text === undefined) {
            return jsonError(
              res,
              501,
              "PinchTab unified backend currently supports fill only with ref + text on browser server.",
            );
          }
          return res.json(
            await actPinchTabBrowserTab(
              profileCtx.profile.name,
              { kind, fields: [{ ref, type: "text", value: text }], targetId },
              targetId,
            ),
          );
        }
        case "close":
          return res.json(
            await actPinchTabBrowserTab(profileCtx.profile.name, { kind, targetId }, targetId),
          );
        default:
          return jsonError(res, 501, unsupportedActMessage(kind));
      }
    } catch (err) {
      return handleRouteError(ctx, res, err);
    }
  });

  registerBrowserAgentActHookRoutes(app, ctx);
  registerBrowserAgentActDownloadRoutes(app, ctx);

  app.post("/response/body", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const url = toStringOrEmpty(body.url);
    if (!url) {
      return jsonError(res, 400, "url is required");
    }
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      const result = await evaluatePinchTabBrowserInstance<{
        ok?: boolean;
        url?: string;
        status?: number;
        text?: string;
      }>(
        profileCtx.profile.name,
        `fetch(${JSON.stringify(url)}, { credentials: "include" }).then(async (res) => JSON.stringify({ ok: res.ok, url: res.url, status: res.status, text: await res.text() }))`,
        targetId,
      );
      res.json({ ok: true, targetId: result.targetId, response: result.value });
    } catch (err) {
      handleRouteError(ctx, res, err);
    }
  });

  app.post("/highlight", async (req, res) => {
    const body = readBody(req);
    const targetId = resolveTargetIdFromBody(body);
    const ref = toStringOrEmpty(body.ref);
    if (!ref) {
      return jsonError(res, 400, "ref is required");
    }

    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      const result = await evaluatePinchTabBrowserInstance<{ ok?: boolean }>(
        profileCtx.profile.name,
        `(() => {
          const refs = (globalThis.__pinchtabSnapshotRefs ?? globalThis.__pinchTabSnapshotRefs ?? {});
          const target = refs[${JSON.stringify(ref)}];
          if (!(target instanceof Element)) {
            return JSON.stringify({ ok: false });
          }
          target.scrollIntoView({ block: "center", inline: "center" });
          const previousOutline = target.style.outline;
          const previousOffset = target.style.outlineOffset;
          target.style.outline = "3px solid #FF4500";
          target.style.outlineOffset = "2px";
          setTimeout(() => {
            target.style.outline = previousOutline;
            target.style.outlineOffset = previousOffset;
          }, 2000);
          return JSON.stringify({ ok: true });
        })()`,
        targetId,
      );
      res.json({ ok: true, targetId: result.targetId, result: result.value });
    } catch (err) {
      handleRouteError(ctx, res, err);
    }
  });
}
