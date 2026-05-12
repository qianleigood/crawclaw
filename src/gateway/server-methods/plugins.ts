import {
  installPluginWithRustLifecycle,
  setPluginEnabledWithRustLifecycle,
} from "../../plugins/rust-lifecycle.js";
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
import type { GatewayRequestHandlers, RespondFn } from "../request-types.js";
import { assertValidParams } from "./validation.js";

function respondPluginLifecycleError(respond: RespondFn, error: unknown) {
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
      const p = params as { id: string };
      const result = await setPluginEnabledWithRustLifecycle({
        id: p.id,
        enabled: true,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
        return;
      }
      respond(true, { ok: true, ...result.value }, undefined);
    } catch (error) {
      respondPluginLifecycleError(respond, error);
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
      const p = params as { id: string };
      const result = await setPluginEnabledWithRustLifecycle({
        id: p.id,
        enabled: false,
      });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
        return;
      }
      respond(true, { ok: true, ...result.value }, undefined);
    } catch (error) {
      respondPluginLifecycleError(respond, error);
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
      const p = params as { raw: string };
      const result = await installPluginWithRustLifecycle({ raw: p.raw });
      if (!result.ok) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, result.error));
        return;
      }
      respond(true, { ok: true, ...result.value }, undefined);
    } catch (error) {
      respondPluginLifecycleError(respond, error);
    }
  },
};
