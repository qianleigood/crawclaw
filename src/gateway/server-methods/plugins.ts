import {
  disablePluginFromControlPlane,
  enablePluginFromControlPlane,
  installPluginFromControlPlane,
  PluginControlPlaneError,
} from "../../plugins/control-plane.js";
import { buildPluginSnapshotReport } from "../../plugins/status.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validatePluginsDisableParams,
  validatePluginsEnableParams,
  validatePluginsInstallParams,
  validatePluginsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";
import { assertValidParams } from "./validation.js";

function respondPluginControlPlaneError(respond: RespondFn, error: unknown) {
  if (error instanceof PluginControlPlaneError) {
    respond(
      false,
      undefined,
      errorShape(
        error.kind === "invalid-request" ? ErrorCodes.INVALID_REQUEST : ErrorCodes.UNAVAILABLE,
        error.message,
      ),
    );
    return;
  }
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
}

export const pluginsHandlers: GatewayRequestHandlers = {
  "plugins.list": async ({ params, respond }) => {
    if (!assertValidParams(params, validatePluginsListParams, "plugins.list", respond)) {
      return;
    }
    try {
      const report = buildPluginSnapshotReport();
      respond(
        true,
        {
          workspaceDir: report.workspaceDir,
          plugins: report.plugins,
          diagnostics: report.diagnostics,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
  "plugins.enable": async ({ params, respond }) => {
    if (!validatePluginsEnableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.enable params: ${formatValidationErrors(validatePluginsEnableParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { id: string; baseHash?: string };
      const result = await enablePluginFromControlPlane({
        pluginId: p.id,
        baseHash: p.baseHash,
      });
      respond(true, { ok: true, ...result }, undefined);
    } catch (error) {
      respondPluginControlPlaneError(respond, error);
    }
  },
  "plugins.disable": async ({ params, respond }) => {
    if (!validatePluginsDisableParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.disable params: ${formatValidationErrors(validatePluginsDisableParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { id: string; baseHash?: string };
      const result = await disablePluginFromControlPlane({
        pluginId: p.id,
        baseHash: p.baseHash,
      });
      respond(true, { ok: true, ...result }, undefined);
    } catch (error) {
      respondPluginControlPlaneError(respond, error);
    }
  },
  "plugins.install": async ({ params, respond }) => {
    if (!validatePluginsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid plugins.install params: ${formatValidationErrors(validatePluginsInstallParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const p = params as { raw: string; baseHash?: string };
      const result = await installPluginFromControlPlane({
        raw: p.raw,
        baseHash: p.baseHash,
      });
      respond(true, { ok: true, ...result }, undefined);
    } catch (error) {
      respondPluginControlPlaneError(respond, error);
    }
  },
};
