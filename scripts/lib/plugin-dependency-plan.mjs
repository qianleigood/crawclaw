import { execFileSync } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { listManagedPluginRuntimeInstallPlan } from "../install-plugin-runtimes.mjs";

const GENERATED_BY = "scripts/generate-plugin-dependency-plan.mjs";
const DEFAULT_JSON_OUTPUT = "docs/.generated/plugin-dependency-plan.json";
const DEFAULT_STATEFILE_OUTPUT = "docs/.generated/plugin-dependency-plan.jsonl";

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sortJsonValue(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)]),
  );
}

function sortObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === "string")
      .toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function sortStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  return [...new Set(values.filter((entry) => typeof entry === "string"))].toSorted((left, right) =>
    left.localeCompare(right),
  );
}

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readJsonFile(filePath) {
  const text = await readTextFile(filePath);
  if (text === null) {
    return null;
  }
  return JSON.parse(text);
}

async function readYamlFile(filePath) {
  const text = await readTextFile(filePath);
  if (text === null) {
    return {};
  }
  return YAML.parse(text) ?? {};
}

async function loadCurrentFile(filePath) {
  const text = await readTextFile(filePath);
  return text ?? "";
}

function listTrackedPluginManifestPaths(repoRoot) {
  try {
    const output = execFileSync("git", ["ls-files", "extensions/*/crawclaw.plugin.json"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/u)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

async function listFilesystemPluginManifestPaths(repoRoot) {
  const extensionsRoot = path.join(repoRoot, "extensions");
  try {
    const dirents = await fs.readdir(extensionsRoot, { withFileTypes: true });
    const manifests = [];
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const manifestPath = path.join("extensions", dirent.name, "crawclaw.plugin.json");
      if (fsSync.existsSync(path.join(repoRoot, manifestPath))) {
        manifests.push(manifestPath);
      }
    }
    return manifests.toSorted((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function listPluginManifestPaths(repoRoot) {
  const tracked = listTrackedPluginManifestPaths(repoRoot);
  if (tracked.length > 0) {
    return tracked;
  }
  return listFilesystemPluginManifestPaths(repoRoot);
}

function collectManifestCapabilities(manifest) {
  const capabilities = [];
  if (Array.isArray(manifest?.providers) && manifest.providers.length > 0) {
    capabilities.push("provider");
  }
  if (Array.isArray(manifest?.channels) && manifest.channels.length > 0) {
    capabilities.push("channel");
  }
  if (Array.isArray(manifest?.cliBackends) && manifest.cliBackends.length > 0) {
    capabilities.push("cli-backend");
  }
  if (Array.isArray(manifest?.skills) && manifest.skills.length > 0) {
    capabilities.push("skill");
  }
  if (manifest?.cli && typeof manifest.cli === "object") {
    capabilities.push("cli");
  }
  if (manifest?.contracts && typeof manifest.contracts === "object") {
    capabilities.push("contract");
  }
  if (capabilities.length === 0) {
    capabilities.push("support");
  }
  return capabilities;
}

function collectManifestContractKeys(manifest) {
  if (!manifest?.contracts || typeof manifest.contracts !== "object") {
    return [];
  }
  return Object.keys(manifest.contracts).toSorted((left, right) => left.localeCompare(right));
}

function collectManifestProviderIds(manifest) {
  if (!Array.isArray(manifest?.providers)) {
    return [];
  }
  return manifest.providers
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      return typeof entry?.id === "string" ? entry.id : null;
    })
    .filter(Boolean)
    .toSorted((left, right) => left.localeCompare(right));
}

function collectManifestChannelIds(manifest) {
  if (!Array.isArray(manifest?.channels)) {
    return [];
  }
  return manifest.channels
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }
      return typeof entry?.id === "string" ? entry.id : null;
    })
    .filter(Boolean)
    .toSorted((left, right) => left.localeCompare(right));
}

function collectPackageEntryPoints(packageJson) {
  const crawclaw = packageJson?.crawclaw;
  const entries = [];
  if (Array.isArray(crawclaw?.extensions)) {
    entries.push(...crawclaw.extensions.filter((entry) => typeof entry === "string"));
  }
  if (typeof crawclaw?.setupEntry === "string") {
    entries.push(crawclaw.setupEntry);
  }
  return [...new Set(entries)].toSorted((left, right) => left.localeCompare(right));
}

async function collectBundledPlugins(repoRoot) {
  const manifestPaths = await listPluginManifestPaths(repoRoot);
  const plugins = [];
  for (const manifestPath of manifestPaths) {
    const manifest = await readJsonFile(path.join(repoRoot, manifestPath));
    if (!manifest || typeof manifest.id !== "string") {
      continue;
    }
    const dir = path.dirname(manifestPath);
    const packageJsonPath = path.join(dir, "package.json");
    const packageJson = await readJsonFile(path.join(repoRoot, packageJsonPath));
    const crawclaw = packageJson?.crawclaw ?? {};
    const entry = {
      capabilities: collectManifestCapabilities(manifest),
      channelIds: collectManifestChannelIds(manifest),
      contractKeys: collectManifestContractKeys(manifest),
      dependencies: sortObject(packageJson?.dependencies),
      devDependencies: sortObject(packageJson?.devDependencies),
      dir,
      enabledByDefault: manifest.enabledByDefault === true,
      id: manifest.id,
      install: {
        entryPoints: collectPackageEntryPoints(packageJson),
        npmSpec:
          typeof crawclaw?.install?.npmSpec === "string" ? crawclaw.install.npmSpec : undefined,
        stageRuntimeDependencies: crawclaw?.bundle?.stageRuntimeDependencies === true,
      },
      manifestPath,
      optionalDependencies: sortObject(packageJson?.optionalDependencies),
      packageJsonPath: packageJson ? packageJsonPath : undefined,
      packageName: typeof packageJson?.name === "string" ? packageJson.name : undefined,
      peerDependencies: sortObject(packageJson?.peerDependencies),
      private: packageJson?.private === true,
      providerIds: collectManifestProviderIds(manifest),
      version: typeof packageJson?.version === "string" ? packageJson.version : undefined,
    };
    plugins.push(sortJsonValue(entry));
  }
  return plugins.toSorted((left, right) => left.id.localeCompare(right.id));
}

async function readLockedRequirements(filePath) {
  const text = await readTextFile(filePath);
  if (text === null) {
    return [];
  }
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function collectManagedRuntimes(repoRoot) {
  const runtimeScriptPath = path.join("scripts", "install-plugin-runtimes.mjs");
  const runtimes = await Promise.all(
    listManagedPluginRuntimeInstallPlan({ platform: "win32" }).map(async (runtime) => {
      const requirementsLockPath = runtime.python?.requirementsLockPath;
      const python = runtime.python
        ? {
            candidates: runtime.python.candidates,
            envOverrides: runtime.python.envOverrides,
            minimumVersion: runtime.python.minimumVersion,
            package: runtime.python.package,
            requirements: requirementsLockPath
              ? await readLockedRequirements(
                  path.isAbsolute(requirementsLockPath)
                    ? requirementsLockPath
                    : path.join(repoRoot, requirementsLockPath),
                )
              : undefined,
            windowsExtraPackages: runtime.python.windowsExtraPackages,
          }
        : undefined;
      return {
        ...runtime,
        python,
        source: runtimeScriptPath,
      };
    }),
  );
  return runtimes.toSorted((left, right) => left.id.localeCompare(right.id)).map(sortJsonValue);
}

function collectVersionSplits(plugins) {
  const sourcesByName = new Map();
  for (const plugin of plugins) {
    for (const section of ["dependencies", "optionalDependencies"]) {
      for (const [name, version] of Object.entries(plugin[section] ?? {})) {
        const sources = sourcesByName.get(name) ?? [];
        sources.push({ pluginId: plugin.id, section, version });
        sourcesByName.set(name, sources);
      }
    }
  }
  return [...sourcesByName.entries()]
    .map(([name, sources]) => ({
      name,
      sources: sources.toSorted((left, right) =>
        `${left.version}:${left.pluginId}`.localeCompare(`${right.version}:${right.pluginId}`),
      ),
      versions: [...new Set(sources.map((entry) => entry.version))].toSorted((left, right) =>
        left.localeCompare(right),
      ),
    }))
    .filter((entry) => entry.versions.length > 1)
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

function collectCapabilityCounts(plugins) {
  const counts = new Map();
  for (const plugin of plugins) {
    for (const capability of plugin.capabilities) {
      counts.set(capability, (counts.get(capability) ?? 0) + 1);
    }
  }
  return Object.fromEntries(
    [...counts.entries()].toSorted(([left], [right]) => left.localeCompare(right)),
  );
}

function countObjectEntries(value) {
  return Object.keys(value ?? {}).length;
}

function buildSummary(plugins) {
  const runtimeDependencyNames = new Set();
  for (const plugin of plugins) {
    for (const section of ["dependencies", "optionalDependencies"]) {
      for (const name of Object.keys(plugin[section] ?? {})) {
        runtimeDependencyNames.add(name);
      }
    }
  }
  return sortJsonValue({
    bundledPluginCount: plugins.length,
    capabilityCounts: collectCapabilityCounts(plugins),
    disabledByDefaultCount: plugins.filter((plugin) => !plugin.enabledByDefault).length,
    enabledByDefaultCount: plugins.filter((plugin) => plugin.enabledByDefault).length,
    pluginRuntimeDependencyVersionSplits: collectVersionSplits(plugins),
    releasedNpmSpecPluginIds: plugins
      .filter((plugin) => typeof plugin.install?.npmSpec === "string")
      .map((plugin) => plugin.id)
      .toSorted((left, right) => left.localeCompare(right)),
    stagedRuntimeDependencyPluginIds: plugins
      .filter((plugin) => plugin.install?.stageRuntimeDependencies === true)
      .map((plugin) => plugin.id)
      .toSorted((left, right) => left.localeCompare(right)),
    uniquePluginRuntimeDependencyCount: runtimeDependencyNames.size,
  });
}

async function collectRootDependencyPlan(repoRoot) {
  const rootPackage = (await readJsonFile(path.join(repoRoot, "package.json"))) ?? {};
  const workspace = await readYamlFile(path.join(repoRoot, "pnpm-workspace.yaml"));
  return sortJsonValue({
    dependencies: sortObject(rootPackage.dependencies),
    devDependencies: sortObject(rootPackage.devDependencies),
    engines: sortObject(rootPackage.engines),
    optionalDependencies: sortObject(rootPackage.optionalDependencies),
    packageManager:
      typeof rootPackage.packageManager === "string" ? rootPackage.packageManager : undefined,
    peerDependencies: sortObject(rootPackage.peerDependencies),
    pnpm: {
      ignoredBuiltDependencies: sortStringArray(rootPackage.pnpm?.ignoredBuiltDependencies),
      overrides: sortObject(rootPackage.pnpm?.overrides),
      packageJsonOnlyBuiltDependencies: sortStringArray(rootPackage.pnpm?.onlyBuiltDependencies),
      workspaceIgnoredBuiltDependencies: sortStringArray(workspace.ignoredBuiltDependencies),
      workspaceMinimumReleaseAge:
        typeof workspace.minimumReleaseAge === "number" ? workspace.minimumReleaseAge : undefined,
      workspaceOnlyBuiltDependencies: sortStringArray(workspace.onlyBuiltDependencies),
      workspacePackages: sortStringArray(workspace.packages),
    },
  });
}

export async function buildPluginDependencyPlan(params = {}) {
  const repoRoot = params.repoRoot ?? process.cwd();
  const bundledPlugins = await collectBundledPlugins(repoRoot);
  const managedRuntimes = await collectManagedRuntimes(repoRoot);
  const root = await collectRootDependencyPlan(repoRoot);
  return sortJsonValue({
    bundledPlugins,
    generatedBy: GENERATED_BY,
    managedRuntimes,
    root,
    schemaVersion: 1,
    summary: {
      ...buildSummary(bundledPlugins),
      rootDependencyCounts: {
        dependencies: countObjectEntries(root.dependencies),
        devDependencies: countObjectEntries(root.devDependencies),
        optionalDependencies: countObjectEntries(root.optionalDependencies),
        peerDependencies: countObjectEntries(root.peerDependencies),
      },
    },
  });
}

function renderJsonl(plan) {
  const lines = [
    { kind: "root", root: plan.root },
    { kind: "summary", summary: plan.summary },
    ...plan.bundledPlugins.map((plugin) => ({ kind: "bundled-plugin", plugin })),
    ...plan.managedRuntimes.map((runtime) => ({ kind: "managed-runtime", runtime })),
  ];
  return `${lines.map((line) => JSON.stringify(sortJsonValue(line))).join("\n")}\n`;
}

export async function renderPluginDependencyPlan(params = {}) {
  const plan = await buildPluginDependencyPlan(params);
  return {
    json: `${JSON.stringify(sortJsonValue(plan), null, 2)}\n`,
    jsonl: renderJsonl(plan),
    plan,
  };
}

export async function writePluginDependencyPlanStatefile(params = {}) {
  const repoRoot = params.repoRoot ?? process.cwd();
  const jsonPath = path.resolve(repoRoot, params.jsonPath ?? DEFAULT_JSON_OUTPUT);
  const statefilePath = path.resolve(repoRoot, params.statefilePath ?? DEFAULT_STATEFILE_OUTPUT);
  const rendered = await renderPluginDependencyPlan({ repoRoot });
  const currentJson = await loadCurrentFile(jsonPath);
  const currentJsonl = await loadCurrentFile(statefilePath);
  const changed = currentJson !== rendered.json || currentJsonl !== rendered.jsonl;

  if (params.check) {
    return {
      changed,
      jsonPath,
      statefilePath,
      wrote: false,
    };
  }

  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, rendered.json, "utf8");
  await fs.writeFile(statefilePath, rendered.jsonl, "utf8");

  return {
    changed,
    jsonPath,
    statefilePath,
    wrote: true,
  };
}

export function relativeToRepo(repoRoot, filePath) {
  return toPosixPath(path.relative(repoRoot, filePath));
}
