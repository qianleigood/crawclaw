#!/usr/bin/env -S node --import tsx

import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  collectBundledExtensionManifestErrors,
  type BundledExtension,
  type ExtensionPackageJson as PackageJson,
} from "./lib/bundled-extension-manifest.ts";
import { listBundledPluginPackArtifacts } from "./lib/bundled-plugin-build-entries.mjs";
import { listStaticExtensionAssetOutputs } from "./runtime-postbuild.mjs";

export { collectBundledExtensionManifestErrors } from "./lib/bundled-extension-manifest.ts";

type PackFile = { path: string };
type PackResult = { files?: PackFile[]; filename?: string; unpackedSize?: number };

const requiredPathGroups = [
  ["dist/index.js", "dist/index.mjs"],
  ["dist/native/crawclaw-runtime", "dist/native/crawclaw-runtime.exe"],
  ["dist/native/crawclaw-gateway", "dist/native/crawclaw-gateway.exe"],
  ["dist/native/crawclaw-native-plugins", "dist/native/crawclaw-native-plugins.exe"],
  ...listBundledPluginPackArtifacts(),
  ...listStaticExtensionAssetOutputs(),
  "docs/reference/templates/AGENTS.md",
  "scripts/npm-runner.mjs",
  "scripts/postinstall-bundled-plugins.mjs",
  "skills/coding-agent/SKILL.md",
  "dist/build-info.json",
];
const forbiddenPrefixes = ["dist-runtime/"];
// 2026.3.12 ballooned to ~213.6 MiB unpacked and correlated with low-memory
// startup/doctor OOM reports. Keep enough headroom for the current pack while
// still catching regressions quickly.
const npmPackUnpackedSizeBudgetBytes = 191 * 1024 * 1024;

function collectBundledExtensions(): BundledExtension[] {
  const extensionsDir = resolve("extensions");
  const entries = readdirSync(extensionsDir, { withFileTypes: true }).filter((entry) =>
    entry.isDirectory(),
  );

  return entries.flatMap((entry) => {
    const packagePath = join(extensionsDir, entry.name, "package.json");
    try {
      return [
        {
          id: entry.name,
          packageJson: JSON.parse(readFileSync(packagePath, "utf8")) as PackageJson,
        },
      ];
    } catch {
      return [];
    }
  });
}

function collectRuntimeDependencySpecs(packageJson: {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}): Map<string, string> {
  return new Map([
    ...Object.entries(packageJson.dependencies ?? {}),
    ...Object.entries(packageJson.optionalDependencies ?? {}),
  ]);
}

function checkBundledExtensionMetadata() {
  const extensions = collectBundledExtensions();
  const manifestErrors = collectBundledExtensionManifestErrors(extensions);
  const rootPackage = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const rootRuntimeDeps = collectRuntimeDependencySpecs(rootPackage);
  const rootMirrorErrors = collectBundledExtensionRootDependencyMirrorErrors(
    extensions,
    rootRuntimeDeps,
  );
  const errors = [...manifestErrors, ...rootMirrorErrors];
  if (errors.length > 0) {
    console.error("release-check: bundled extension manifest validation failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
}

export function collectBundledExtensionRootDependencyMirrorErrors(
  extensions: BundledExtension[],
  rootRuntimeDeps: ReadonlyMap<string, string>,
): string[] {
  const errors: string[] = [];

  for (const extension of extensions) {
    const rawReleaseChecks = extension.packageJson.crawclaw?.releaseChecks;
    const allowlist = (rawReleaseChecks as { rootDependencyMirrorAllowlist?: unknown } | undefined)
      ?.rootDependencyMirrorAllowlist;

    if (allowlist === undefined) {
      continue;
    }
    if (!Array.isArray(allowlist)) {
      errors.push(
        `bundled extension '${extension.id}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist must be an array`,
      );
      continue;
    }

    const extensionRuntimeDeps = collectRuntimeDependencySpecs(extension.packageJson);

    for (const entry of allowlist) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        errors.push(
          `bundled extension '${extension.id}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entries must be non-empty strings`,
        );
        continue;
      }

      const extensionSpec = extensionRuntimeDeps.get(entry);
      if (!extensionSpec) {
        errors.push(
          `bundled extension '${extension.id}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '${entry}' must be declared in extension runtime dependencies`,
        );
      }
      const rootSpec = rootRuntimeDeps.get(entry);
      if (!rootSpec) {
        errors.push(
          `bundled extension '${extension.id}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '${entry}' must be mirrored in root runtime dependencies`,
        );
      }
      if (!extensionSpec || !rootSpec) {
        continue;
      }
      if (extensionSpec !== rootSpec) {
        errors.push(
          `bundled extension '${extension.id}' manifest invalid | crawclaw.releaseChecks.rootDependencyMirrorAllowlist entry '${entry}' must match root runtime dependency version (extension '${extensionSpec}', root '${rootSpec}')`,
        );
      }
    }
  }

  return errors;
}

function runPackDry(): PackResult[] {
  const raw = execSync("npm pack --dry-run --json --ignore-scripts", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 100,
  });
  return JSON.parse(raw) as PackResult[];
}

export function collectMissingPackPaths(paths: Iterable<string>): string[] {
  const available = new Set(paths);
  return requiredPathGroups
    .flatMap((group) => {
      if (Array.isArray(group)) {
        return group.some((path) => available.has(path)) ? [] : [group.join(" or ")];
      }
      return available.has(group) ? [] : [group];
    })
    .toSorted((left, right) => left.localeCompare(right));
}

export function collectForbiddenPackPaths(paths: Iterable<string>): string[] {
  const isAllowedBundledPluginNodeModulesPath = (path: string) =>
    /^dist\/extensions\/[^/]+\/node_modules\//.test(path);
  return [...paths]
    .filter(
      (path) =>
        forbiddenPrefixes.some((prefix) => path.startsWith(prefix)) ||
        (/node_modules\//.test(path) && !isAllowedBundledPluginNodeModulesPath(path)),
    )
    .toSorted((left, right) => left.localeCompare(right));
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function resolvePackResultLabel(entry: PackResult, index: number): string {
  return entry.filename?.trim() || `pack result #${index + 1}`;
}

function formatPackUnpackedSizeBudgetError(params: {
  label: string;
  unpackedSize: number;
}): string {
  return [
    `${params.label} unpackedSize ${params.unpackedSize} bytes (${formatMiB(params.unpackedSize)}) exceeds budget ${npmPackUnpackedSizeBudgetBytes} bytes (${formatMiB(npmPackUnpackedSizeBudgetBytes)}).`,
    "Investigate duplicate channel shims, copied extension trees, or other accidental pack bloat before release.",
  ].join(" ");
}

export function collectPackUnpackedSizeErrors(results: Iterable<PackResult>): string[] {
  const entries = Array.from(results);
  const errors: string[] = [];
  let checkedCount = 0;

  for (const [index, entry] of entries.entries()) {
    if (typeof entry.unpackedSize !== "number" || !Number.isFinite(entry.unpackedSize)) {
      continue;
    }
    checkedCount += 1;
    if (entry.unpackedSize <= npmPackUnpackedSizeBudgetBytes) {
      continue;
    }
    const label = resolvePackResultLabel(entry, index);
    errors.push(formatPackUnpackedSizeBudgetError({ label, unpackedSize: entry.unpackedSize }));
  }

  if (entries.length > 0 && checkedCount === 0) {
    errors.push(
      "npm pack --dry-run produced no unpackedSize data; pack size budget was not verified.",
    );
  }

  return errors;
}

async function main() {
  checkBundledExtensionMetadata();

  const results = runPackDry();
  const files = results.flatMap((entry) => entry.files ?? []);
  const paths = new Set(files.map((file) => file.path));

  const missing = requiredPathGroups
    .flatMap((group) => {
      if (Array.isArray(group)) {
        return group.some((path) => paths.has(path)) ? [] : [group.join(" or ")];
      }
      return paths.has(group) ? [] : [group];
    })
    .toSorted((left, right) => left.localeCompare(right));
  const forbidden = collectForbiddenPackPaths(paths);
  const sizeErrors = collectPackUnpackedSizeErrors(results);

  if (missing.length > 0 || forbidden.length > 0 || sizeErrors.length > 0) {
    if (missing.length > 0) {
      console.error("release-check: missing files in npm pack:");
      for (const path of missing) {
        console.error(`  - ${path}`);
      }
      if (missing.some((path) => path === "dist/build-info.json" || path.startsWith("dist/"))) {
        console.error(
          "release-check: build artifacts are missing. Run `pnpm build` before `pnpm release:check`.",
        );
      }
    }
    if (forbidden.length > 0) {
      console.error("release-check: forbidden files in npm pack:");
      for (const path of forbidden) {
        console.error(`  - ${path}`);
      }
    }
    if (sizeErrors.length > 0) {
      console.error("release-check: npm pack unpacked size budget exceeded:");
      for (const error of sizeErrors) {
        console.error(`  - ${error}`);
      }
    }
    process.exit(1);
  }

  console.log("release-check: npm pack contents look OK.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
