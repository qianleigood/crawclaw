import fs from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { resolveBundledPluginPublicSurfacePath } from "../plugins/bundled-plugin-metadata.js";
import {
  buildPluginLoaderAliasMap,
  buildPluginLoaderJitiOptions,
  shouldPreferNativeJiti,
} from "../plugins/sdk-alias.js";

const PUBLIC_SURFACE_SOURCE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs", ".cts", ".cjs"] as const;

export const ALWAYS_ALLOWED_RUNTIME_DIR_NAMES = new Set(["media-understanding-core", "speech-core"]);

export function resolveSourceFirstPublicSurfacePath(params: {
  bundledPluginsDir?: string;
  dirName: string;
  artifactBasename: string;
  packageRoot: string;
}): string | null {
  const sourceBaseName = params.artifactBasename.replace(/\.js$/u, "");
  const sourceRoot = params.bundledPluginsDir ?? path.resolve(params.packageRoot, "extensions");
  for (const ext of PUBLIC_SURFACE_SOURCE_EXTENSIONS) {
    const candidate = path.resolve(sourceRoot, params.dirName, `${sourceBaseName}${ext}`);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveFacadeModuleLocation(params: {
  dirName: string;
  artifactBasename: string;
  bundledPluginsDir?: string;
  currentModulePath: string;
  packageRoot: string;
}): { modulePath: string; boundaryRoot: string } | null {
  const preferSource = !params.currentModulePath.includes(`${path.sep}dist${path.sep}`);
  if (preferSource) {
    const modulePath =
      resolveSourceFirstPublicSurfacePath(params) ??
      resolveBundledPluginPublicSurfacePath({
        rootDir: params.packageRoot,
        ...(params.bundledPluginsDir ? { bundledPluginsDir: params.bundledPluginsDir } : {}),
        dirName: params.dirName,
        artifactBasename: params.artifactBasename,
      });
    if (!modulePath) {
      return null;
    }
    return {
      modulePath,
      boundaryRoot:
        params.bundledPluginsDir &&
        modulePath.startsWith(path.resolve(params.bundledPluginsDir) + path.sep)
          ? path.resolve(params.bundledPluginsDir)
          : params.packageRoot,
    };
  }
  const modulePath = resolveBundledPluginPublicSurfacePath({
    rootDir: params.packageRoot,
    ...(params.bundledPluginsDir ? { bundledPluginsDir: params.bundledPluginsDir } : {}),
    dirName: params.dirName,
    artifactBasename: params.artifactBasename,
  });
  if (!modulePath) {
    return null;
  }
  return {
    modulePath,
    boundaryRoot:
      params.bundledPluginsDir && modulePath.startsWith(path.resolve(params.bundledPluginsDir) + path.sep)
        ? path.resolve(params.bundledPluginsDir)
        : params.packageRoot,
  };
}

export function getOrCreateFacadeJitiLoader(params: {
  modulePath: string;
  processArgv1: string | undefined;
  importMetaUrl: string;
  cache: Map<string, ReturnType<typeof createJiti>>;
}): ReturnType<typeof createJiti> {
  const tryNative =
    shouldPreferNativeJiti(params.modulePath) ||
    params.modulePath.includes(`${path.sep}dist${path.sep}`);
  const aliasMap = buildPluginLoaderAliasMap(
    params.modulePath,
    params.processArgv1,
    params.importMetaUrl,
  );
  const cacheKey = JSON.stringify({
    tryNative,
    aliasMap: Object.entries(aliasMap).toSorted(([left], [right]) => left.localeCompare(right)),
  });
  const cached = params.cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const loader = createJiti(params.importMetaUrl, {
    ...buildPluginLoaderJitiOptions(aliasMap),
    tryNative,
  });
  params.cache.set(cacheKey, loader);
  return loader;
}

function createLazyFacadeValueLoader<T>(load: () => T): () => T {
  let loaded = false;
  let value: T;
  return () => {
    if (!loaded) {
      value = load();
      loaded = true;
    }
    return value;
  };
}

function createLazyFacadeProxyValue<T extends object>(params: { load: () => T; target: object }): T {
  const resolve = createLazyFacadeValueLoader(params.load);
  return new Proxy(params.target, {
    defineProperty(_target, property, descriptor) {
      return Reflect.defineProperty(resolve(), property, descriptor);
    },
    deleteProperty(_target, property) {
      return Reflect.deleteProperty(resolve(), property);
    },
    get(_target, property, receiver) {
      return Reflect.get(resolve(), property, receiver);
    },
    getOwnPropertyDescriptor(_target, property) {
      return Reflect.getOwnPropertyDescriptor(resolve(), property);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve());
    },
    has(_target, property) {
      return Reflect.has(resolve(), property);
    },
    isExtensible() {
      return Reflect.isExtensible(resolve());
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
    preventExtensions() {
      return Reflect.preventExtensions(resolve());
    },
    set(_target, property, value, receiver) {
      return Reflect.set(resolve(), property, value, receiver);
    },
    setPrototypeOf(_target, prototype) {
      return Reflect.setPrototypeOf(resolve(), prototype);
    },
  }) as T;
}

export function createLazyFacadeObjectValue<T extends object>(load: () => T): T {
  return createLazyFacadeProxyValue({ load, target: {} });
}

export function createLazyFacadeArrayValue<T extends readonly unknown[]>(load: () => T): T {
  return createLazyFacadeProxyValue({ load, target: [] });
}
