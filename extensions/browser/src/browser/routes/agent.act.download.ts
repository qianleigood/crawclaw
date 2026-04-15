import fs from "node:fs/promises";
import path from "node:path";
import type { BrowserRouteContext } from "../server-context.types.js";
import { readBody, resolveProfileContext } from "./agent.shared.js";
import { ensureOutputRootDir, resolveWritableOutputPathOrRespond } from "./output-paths.js";
import { DEFAULT_DOWNLOAD_DIR } from "./path-output.js";
import { evaluatePinchTabBrowserInstance } from "./pinchtab-backend.js";
import type { BrowserRouteRegistrar } from "./types.js";
import { jsonError, toNumber, toStringOrEmpty } from "./utils.js";

export function registerBrowserAgentActDownloadRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.post("/wait/download", async (req, res) => {
    const body = readBody(req);
    const out = toStringOrEmpty(body.path) || "";
    const timeoutMs = toNumber(body.timeoutMs);
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      await ensureOutputRootDir(DEFAULT_DOWNLOAD_DIR);
      const downloadPath = await resolveWritableOutputPathOrRespond({
        res,
        rootDir: DEFAULT_DOWNLOAD_DIR,
        requestedPath: out || "download.bin",
        scopeLabel: "downloads directory",
      });
      if (!downloadPath) {
        return;
      }
      const result = await evaluatePinchTabBrowserInstance<{
        ok?: boolean;
        url?: string;
        status?: number;
        base64?: string;
      }>(
        profileCtx.profile.name,
        `fetch(window.location.href, { credentials: "include" }).then(async (res) => { const bytes = new Uint8Array(await res.arrayBuffer()); let binary = ""; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk) { binary += String.fromCharCode(...bytes.slice(i, i + chunk)); } return JSON.stringify({ ok: res.ok, url: res.url, status: res.status, base64: btoa(binary) }); })`,
        typeof body.targetId === "string" ? body.targetId.trim() || undefined : undefined,
      );
      if (typeof result.value?.base64 !== "string" || !result.value.base64) {
        return jsonError(res, 500, "PinchTab download failed.");
      }
      await fs.writeFile(downloadPath, Buffer.from(result.value.base64, "base64"));
      res.json({
        ok: true,
        targetId: result.targetId,
        download: {
          url: result.value.url ?? "",
          suggestedFilename: path.basename(downloadPath),
          path: path.resolve(downloadPath),
          timeoutMs,
        },
      });
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.post("/download", async (req, res) => {
    const body = readBody(req);
    const ref = toStringOrEmpty(body.ref);
    const out = toStringOrEmpty(body.path);
    if (!ref) {
      return jsonError(res, 400, "ref is required");
    }
    if (!out) {
      return jsonError(res, 400, "path is required");
    }
    return jsonError(
      res,
      501,
      "PinchTab unified backend does not support ref-scoped downloads on browser server yet; use /wait/download instead.",
    );
  });
}
