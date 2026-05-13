import fs from "node:fs";
import { createRequire } from "node:module";
import { openBoundaryFileSync } from "../../infra/boundary-file-read.js";
import {
  buildPluginLoaderAliasMap,
  buildPluginLoaderJitiOptions,
  shouldPreferNativeJiti,
} from "../../plugins/sdk-alias.js";

type CreateJiti = typeof import("jiti").createJiti;
type JitiLoader = ReturnType<CreateJiti>;

const require = createRequire(import.meta.url);
let createJitiFn: CreateJiti | null = null;

function loadCreateJiti(): CreateJiti {
  if (!createJitiFn) {
    createJitiFn = (require("jiti") as { createJiti: CreateJiti }).createJiti;
  }
  return createJitiFn;
}

function createCompatModuleLoader() {
  const jitiLoaders = new Map<string, JitiLoader>();

  return (modulePath: string) => {
    const tryNative = shouldPreferNativeJiti(modulePath);
    const aliasMap = buildPluginLoaderAliasMap(modulePath, process.argv[1], import.meta.url);
    const cacheKey = JSON.stringify({
      tryNative,
      aliasMap: Object.entries(aliasMap).toSorted(([left], [right]) => left.localeCompare(right)),
    });
    const cached = jitiLoaders.get(cacheKey);
    if (cached) {
      return cached;
    }
    const loader = loadCreateJiti()(import.meta.url, {
      ...buildPluginLoaderJitiOptions(aliasMap),
      tryNative,
    });
    jitiLoaders.set(cacheKey, loader);
    return loader;
  };
}

const loadCompatModule = createCompatModuleLoader();

export function loadBundledTsChannelModule(modulePath: string, rootDir: string): unknown {
  const opened = openBoundaryFileSync({
    absolutePath: modulePath,
    rootPath: rootDir,
    boundaryLabel: "plugin root",
    rejectHardlinks: false,
    skipLexicalRootCheck: true,
  });
  if (!opened.ok) {
    throw new Error("plugin entry path escapes plugin root or fails alias checks");
  }
  const safePath = opened.path;
  fs.closeSync(opened.fd);
  return loadCompatModule(safePath)(safePath);
}
