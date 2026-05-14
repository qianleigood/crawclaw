import { resolveUserPath } from "../utils.js";
import { resolveFileNpmSpecToLocalPath } from "./plugins-command-helpers.js";

export type PluginInstallRequestContext = {
  rawSpec: string;
  normalizedSpec: string;
  resolvedPath?: string;
  marketplace?: string;
};

type PluginInstallRequestResolution =
  | { ok: true; request: PluginInstallRequestContext }
  | { ok: false; error: string };

export function resolvePluginInstallRequestContext(params: {
  rawSpec: string;
  marketplace?: string;
}): PluginInstallRequestResolution {
  if (params.marketplace) {
    return {
      ok: true,
      request: {
        rawSpec: params.rawSpec,
        normalizedSpec: params.rawSpec,
        marketplace: params.marketplace,
      },
    };
  }
  const fileSpec = resolveFileNpmSpecToLocalPath(params.rawSpec);
  if (fileSpec && !fileSpec.ok) {
    return {
      ok: false,
      error: fileSpec.error,
    };
  }
  const normalizedSpec = fileSpec && fileSpec.ok ? fileSpec.path : params.rawSpec;
  return {
    ok: true,
    request: {
      rawSpec: params.rawSpec,
      normalizedSpec,
      resolvedPath: resolveUserPath(normalizedSpec),
    },
  };
}
