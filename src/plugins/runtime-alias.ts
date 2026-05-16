import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCrawClawPackageRootSync } from "../infra/crawclaw-root.js";

type RuntimeAliasCandidateKind = "dist" | "src";
export type RuntimeResolutionPreference = "auto" | "dist" | "src";

export type LoaderModuleResolveParams = {
  modulePath?: string;
  argv1?: string;
  cwd?: string;
  moduleUrl?: string;
  runtimeResolution?: RuntimeResolutionPreference;
};

function resolveLoaderModulePath(params: LoaderModuleResolveParams = {}): string {
  return params.modulePath ?? fileURLToPath(params.moduleUrl ?? import.meta.url);
}

export function resolveLoaderPackageRoot(
  params: LoaderModuleResolveParams & { modulePath: string },
): string | null {
  const cwd = params.cwd ?? path.dirname(params.modulePath);
  const fromModulePath = resolveCrawClawPackageRootSync({ cwd });
  if (fromModulePath) {
    return fromModulePath;
  }
  const argv1 = params.argv1 ?? process.argv[1];
  const moduleUrl = params.moduleUrl ?? (params.modulePath ? undefined : import.meta.url);
  return resolveCrawClawPackageRootSync({
    cwd,
    ...(argv1 ? { argv1 } : {}),
    ...(moduleUrl ? { moduleUrl } : {}),
  });
}

export function resolveRuntimeAliasCandidateOrder(params: {
  modulePath: string;
  isProduction: boolean;
  runtimeResolution?: RuntimeResolutionPreference;
}): RuntimeAliasCandidateKind[] {
  if (params.runtimeResolution === "dist") {
    return ["dist", "src"];
  }
  if (params.runtimeResolution === "src") {
    return ["src", "dist"];
  }
  const normalizedModulePath = params.modulePath.replace(/\\/g, "/");
  const isDistRuntime = normalizedModulePath.includes("/dist/");
  return isDistRuntime || params.isProduction ? ["dist", "src"] : ["src", "dist"];
}

export function buildPluginLoaderAliasMap(): Record<string, string> {
  return {};
}

export function resolvePluginRuntimeModulePath(
  params: LoaderModuleResolveParams = {},
): string | null {
  try {
    const modulePath = resolveLoaderModulePath(params);
    const orderedKinds = resolveRuntimeAliasCandidateOrder({
      modulePath,
      isProduction: process.env.NODE_ENV === "production",
      runtimeResolution: params.runtimeResolution,
    });
    const packageRoot = resolveLoaderPackageRoot({ ...params, modulePath });
    const candidates = packageRoot
      ? orderedKinds.map((kind) =>
          kind === "src"
            ? path.join(packageRoot, "src", "plugins", "runtime", "index.ts")
            : path.join(packageRoot, "dist", "plugins", "runtime", "index.js"),
        )
      : [
          path.join(path.dirname(modulePath), "runtime", "index.ts"),
          path.join(path.dirname(modulePath), "runtime", "index.js"),
        ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function buildPluginLoaderJitiOptions(aliasMap: Record<string, string>) {
  return {
    interopDefault: true,
    tryNative: true,
    extensions: [".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx", ".js", ".mjs", ".cjs", ".json"],
    ...(Object.keys(aliasMap).length > 0
      ? {
          alias: aliasMap,
        }
      : {}),
  };
}

export function shouldPreferNativeJiti(modulePath: string): boolean {
  const versions = process.versions as { bun?: string };
  if (typeof versions.bun === "string") {
    return false;
  }
  switch (path.extname(modulePath).toLowerCase()) {
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".json":
      return true;
    default:
      return false;
  }
}
