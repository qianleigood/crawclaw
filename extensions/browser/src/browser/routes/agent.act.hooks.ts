import type { BrowserRouteContext } from "../server-context.types.js";
import { readBody, resolveProfileContext } from "./agent.shared.js";
import { DEFAULT_UPLOAD_DIR, resolveExistingPathsWithinRoot } from "./path-output.js";
import { armPinchTabDialog, setPinchTabUpload } from "./pinchtab-backend.js";
import type { BrowserRouteRegistrar } from "./types.js";
import { jsonError, toBoolean, toStringArray, toStringOrEmpty } from "./utils.js";

export function registerBrowserAgentActHookRoutes(
  app: BrowserRouteRegistrar,
  ctx: BrowserRouteContext,
) {
  app.post("/hooks/file-chooser", async (req, res) => {
    const body = readBody(req);
    const ref = toStringOrEmpty(body.ref) || toStringOrEmpty(body.inputRef) || undefined;
    const element = toStringOrEmpty(body.element) || undefined;
    const paths = toStringArray(body.paths) ?? [];
    if (!paths.length) {
      return jsonError(res, 400, "paths are required");
    }
    if (element) {
      return jsonError(
        res,
        501,
        "PinchTab unified backend currently supports file upload by ref/inputRef only.",
      );
    }
    if (!ref) {
      return jsonError(res, 400, "ref or inputRef is required");
    }
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    const uploadPathsResult = await resolveExistingPathsWithinRoot({
      rootDir: DEFAULT_UPLOAD_DIR,
      requestedPaths: paths,
      scopeLabel: `uploads directory (${DEFAULT_UPLOAD_DIR})`,
    });
    if (!uploadPathsResult.ok) {
      res.status(400).json({ error: uploadPathsResult.error });
      return;
    }
    try {
      res.json(
        await setPinchTabUpload(
          profileCtx.profile.name,
          uploadPathsResult.paths,
          ref,
          typeof body.targetId === "string" ? body.targetId.trim() || undefined : undefined,
        ),
      );
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });

  app.post("/hooks/dialog", async (req, res) => {
    const body = readBody(req);
    const accept = toBoolean(body.accept);
    const promptText = toStringOrEmpty(body.promptText) || undefined;
    if (accept === undefined) {
      return jsonError(res, 400, "accept is required");
    }
    const profileCtx = resolveProfileContext(req, res, ctx);
    if (!profileCtx) {
      return;
    }
    try {
      res.json(
        await armPinchTabDialog(profileCtx.profile.name, {
          accept,
          promptText,
          targetId:
            typeof body.targetId === "string" ? body.targetId.trim() || undefined : undefined,
        }),
      );
    } catch (err) {
      jsonError(res, 500, String(err));
    }
  });
}
