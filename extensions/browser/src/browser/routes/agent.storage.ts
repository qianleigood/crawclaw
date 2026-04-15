import type { BrowserRouteContext } from "../server-context.types.js";
import { readBody, resolveProfileContext } from "./agent.shared.js";
import { evaluatePinchTabBrowserInstance, getPinchTabCookies } from "./pinchtab-backend.js";
import type { BrowserRouteRegistrar } from "./types.js";
import { jsonError, toBoolean, toStringOrEmpty } from "./utils.js";

type StorageKind = "local" | "session";

export function parseStorageKind(raw: string): StorageKind | null {
  if (raw === "local" || raw === "session") {
    return raw;
  }
  return null;
}

function readTargetId(value: unknown) {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

export function parseStorageMutationRequest(
  kindParam: unknown,
  body: Record<string, unknown>,
): { kind: StorageKind | null; targetId: string | undefined } {
  return {
    kind: parseStorageKind(toStringOrEmpty(kindParam)),
    targetId: readTargetId(body.targetId),
  };
}

export function parseRequiredStorageMutationRequest(
  kindParam: unknown,
  body: Record<string, unknown>,
): { kind: StorageKind; targetId: string | undefined } | null {
  const parsed = parseStorageMutationRequest(kindParam, body);
  if (!parsed.kind) {
    return null;
  }
  return {
    kind: parsed.kind,
    targetId: parsed.targetId,
  };
}

export function registerBrowserAgentStorageRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.get("/cookies", async (req, res) => {
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      const result = await getPinchTabCookies(
        profileCtx.profile.name,
        typeof req.query.targetId === "string" ? req.query.targetId.trim() || undefined : undefined,
      );
      res.json({ ok: true, targetId: result.targetId, ...result.result });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.post("/cookies/set", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support cookies/set on browser server yet.",
    );
  });

  app.post("/cookies/clear", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support cookies/clear on browser server yet.",
    );
  });

  app.get("/storage/:kind", async (req, res) => {
    const kind = parseStorageKind(toStringOrEmpty(req.params.kind));
    if (!kind) {
      return jsonError(res, 400, "kind must be local|session");
    }
    const key = toStringOrEmpty(req.query.key);
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      const result = await evaluatePinchTabBrowserInstance<{
        kind: StorageKind;
        values: Record<string, string | null>;
      }>(
        profileCtx.profile.name,
        `JSON.stringify((() => { const mode = ${JSON.stringify(kind)}; const target = mode === "session" ? window.sessionStorage : window.localStorage; const key = ${JSON.stringify(key || null)}; const values = {}; if (key) { values[key] = target.getItem(key); } else { for (let i = 0; i < target.length; i += 1) { const k = target.key(i); if (k) values[k] = target.getItem(k); } } return { kind: mode, values }; })())`,
        typeof req.query.targetId === "string" ? req.query.targetId.trim() || undefined : undefined,
      );
      res.json({ ok: true, targetId: result.targetId, ...(result.value ?? { kind, values: {} }) });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.post("/storage/:kind/set", async (req, res) => {
    const kind = parseStorageKind(toStringOrEmpty(req.params.kind));
    if (!kind) {
      return jsonError(res, 400, "kind must be local|session");
    }
    const body = readBody(req);
    const key = toStringOrEmpty(body.key);
    if (!key) {
      return jsonError(res, 400, "key is required");
    }
    const value = typeof body.value === "string" ? body.value : "";
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      const result = await evaluatePinchTabBrowserInstance(
        profileCtx.profile.name,
        `JSON.stringify((() => { const target = ${JSON.stringify(kind)} === "session" ? window.sessionStorage : window.localStorage; target.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}); return { ok: true }; })())`,
        readTargetId(body.targetId),
      );
      res.json({ ok: true, targetId: result.targetId });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.post("/storage/:kind/clear", async (req, res) => {
    const kind = parseStorageKind(toStringOrEmpty(req.params.kind));
    if (!kind) {
      return jsonError(res, 400, "kind must be local|session");
    }
    const body = readBody(req);
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      const result = await evaluatePinchTabBrowserInstance(
        profileCtx.profile.name,
        `JSON.stringify((() => { const target = ${JSON.stringify(kind)} === "session" ? window.sessionStorage : window.localStorage; target.clear(); return { ok: true }; })())`,
        readTargetId(body.targetId),
      );
      res.json({ ok: true, targetId: result.targetId });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.post("/set/offline", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support offline emulation on browser server yet.",
    );
  });

  app.post("/set/headers", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support extra headers on browser server yet.",
    );
  });

  app.post("/set/credentials", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support HTTP credentials on browser server yet.",
    );
  });

  app.post("/set/geolocation", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support geolocation on browser server yet.",
    );
  });

  app.post("/set/media", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support media emulation on browser server yet.",
    );
  });

  app.post("/set/timezone", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support timezone emulation on browser server yet.",
    );
  });

  app.post("/set/locale", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support locale emulation on browser server yet.",
    );
  });

  app.post("/set/device", async (_req, res) => {
    jsonError(
      res,
      501,
      "PinchTab unified backend does not support device emulation on browser server yet.",
    );
  });
}
