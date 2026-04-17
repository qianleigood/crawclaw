"use strict";

const path = require("node:path");
const fs = require("node:fs");

let diagnosticEventsModule = null;
const jitiLoaders = new Map();
const pluginSdkSubpathsCache = new Map();
const isDistRootAlias = __filename.includes(
  `${path.sep}dist${path.sep}plugin-sdk${path.sep}root-alias.cjs`,
);
// Source plugin entry loading must stay on the source graph end-to-end. Mixing a
// source root alias with dist compat/runtime shims can split singleton deps
// (for example matrix-js-sdk) across two module graphs.
const shouldPreferSourceGraph =
  !isDistRootAlias &&
  (process.env.NODE_ENV !== "production" ||
    Boolean(process.env.VITEST) ||
    process.env.CRAWCLAW_PLUGIN_SDK_SOURCE_IN_TESTS === "1");

function emptyPluginConfigSchema() {
  function error(message) {
    return { success: false, error: { issues: [{ path: [], message }] } };
  }

  return {
    safeParse(value) {
      if (value === undefined) {
        return { success: true, data: undefined };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return error("expected config object");
      }
      if (Object.keys(value).length > 0) {
        return error("config must be empty");
      }
      return { success: true, data: value };
    },
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  };
}

function resolveCommandAuthorizedFromAuthorizers(params) {
  const { useAccessGroups, authorizers } = params;
  const mode = params.modeWhenAccessGroupsOff ?? "allow";
  if (!useAccessGroups) {
    if (mode === "allow") {
      return true;
    }
    if (mode === "deny") {
      return false;
    }
    const anyConfigured = authorizers.some((entry) => entry.configured);
    if (!anyConfigured) {
      return true;
    }
    return authorizers.some((entry) => entry.configured && entry.allowed);
  }
  return authorizers.some((entry) => entry.configured && entry.allowed);
}

function resolveControlCommandGate(params) {
  const commandAuthorized = resolveCommandAuthorizedFromAuthorizers({
    useAccessGroups: params.useAccessGroups,
    authorizers: params.authorizers,
    modeWhenAccessGroupsOff: params.modeWhenAccessGroupsOff,
  });
  const shouldBlock = params.allowTextCommands && params.hasControlCommand && !commandAuthorized;
  return { commandAuthorized, shouldBlock };
}

function onDiagnosticEvent(listener) {
  const diagnosticEvents = loadDiagnosticEventsModule();
  if (!diagnosticEvents || typeof diagnosticEvents.onDiagnosticEvent !== "function") {
    throw new Error("crawclaw/plugin-sdk root alias could not resolve onDiagnosticEvent");
  }
  return diagnosticEvents.onDiagnosticEvent(listener);
}

function getPackageRoot() {
  return path.resolve(__dirname, "..", "..");
}

function findDistChunkByPrefix(prefix) {
  const distRoot = path.join(getPackageRoot(), "dist");
  try {
    const entries = fs.readdirSync(distRoot, { withFileTypes: true });
    const match = entries.find(
      (entry) =>
        entry.isFile() && entry.name.startsWith(`${prefix}-`) && entry.name.endsWith(".js"),
    );
    return match ? path.join(distRoot, match.name) : null;
  } catch {
    return null;
  }
}

function listPluginSdkExportedSubpaths() {
  const packageRoot = getPackageRoot();
  if (pluginSdkSubpathsCache.has(packageRoot)) {
    return pluginSdkSubpathsCache.get(packageRoot);
  }

  let subpaths = [];
  try {
    const packageJsonPath = path.join(packageRoot, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    subpaths = Object.keys(packageJson.exports ?? {})
      .filter((key) => key.startsWith("./plugin-sdk/"))
      .map((key) => key.slice("./plugin-sdk/".length));
  } catch {
    subpaths = [];
  }

  pluginSdkSubpathsCache.set(packageRoot, subpaths);
  return subpaths;
}

function buildPluginSdkAliasMap(useDist) {
  const packageRoot = getPackageRoot();
  const pluginSdkDir = path.join(packageRoot, useDist ? "dist" : "src", "plugin-sdk");
  const ext = useDist ? ".js" : ".ts";
  const aliasMap = {
    "crawclaw/plugin-sdk": __filename,
  };

  for (const subpath of listPluginSdkExportedSubpaths()) {
    const candidate = path.join(pluginSdkDir, `${subpath}${ext}`);
    if (fs.existsSync(candidate)) {
      aliasMap[`crawclaw/plugin-sdk/${subpath}`] = candidate;
    }
  }

  return aliasMap;
}

function getJiti(tryNative) {
  if (jitiLoaders.has(tryNative)) {
    return jitiLoaders.get(tryNative);
  }

  const { createJiti } = require("jiti");
  const jitiLoader = createJiti(__filename, {
    alias: buildPluginSdkAliasMap(tryNative),
    interopDefault: true,
    // Prefer Node's native sync ESM loader for built dist/plugin-sdk/*.js files
    // so local plugins do not create a second transpiled CrawClaw core graph.
    tryNative,
    extensions: [".ts", ".tsx", ".mts", ".cts", ".mtsx", ".ctsx", ".js", ".mjs", ".cjs", ".json"],
  });
  jitiLoaders.set(tryNative, jitiLoader);
  return jitiLoader;
}

function loadDiagnosticEventsModule() {
  if (diagnosticEventsModule) {
    return diagnosticEventsModule;
  }

  const directDistCandidate = path.resolve(
    __dirname,
    "..",
    "..",
    "dist",
    "infra",
    "diagnostic-events.js",
  );
  if (!shouldPreferSourceGraph) {
    const distCandidate =
      (fs.existsSync(directDistCandidate) && directDistCandidate) ||
      findDistChunkByPrefix("diagnostic-events");
    if (distCandidate) {
      try {
        diagnosticEventsModule = normalizeDiagnosticEventsModule(getJiti(true)(distCandidate));
        return diagnosticEventsModule;
      } catch {
        // Fall through to source path if dist is unavailable or stale.
      }
    }
  }

  diagnosticEventsModule = normalizeDiagnosticEventsModule(
    getJiti(false)(path.join(getPackageRoot(), "src", "infra", "diagnostic-events.ts")),
  );
  return diagnosticEventsModule;
}

function normalizeDiagnosticEventsModule(mod) {
  if (!mod || typeof mod !== "object") {
    return mod;
  }
  if (typeof mod.onDiagnosticEvent === "function") {
    return mod;
  }
  if (typeof mod.r === "function") {
    return {
      ...mod,
      onDiagnosticEvent: mod.r,
    };
  }
  return mod;
}

const fastExports = {
  emptyPluginConfigSchema,
  onDiagnosticEvent,
  resolveControlCommandGate,
};

const target = { ...fastExports };
const rootExports = target;

Object.defineProperty(target, "__esModule", {
  configurable: true,
  enumerable: false,
  writable: false,
  value: true,
});
Object.defineProperty(target, "default", {
  configurable: true,
  enumerable: false,
  get() {
    return rootExports;
  },
});

module.exports = rootExports;
