import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LEGACY_DAEMON_CLI_EXPORTS = [
  "runDaemonInstall",
  "runDaemonRestart",
  "runDaemonStart",
  "runDaemonStatus",
  "runDaemonStop",
  "runDaemonUninstall",
] as const;

type LegacyDaemonCliExport = (typeof LEGACY_DAEMON_CLI_EXPORTS)[number];
type LegacyDaemonCliAccessors = {
  runDaemonRestart: string;
} & Partial<Record<Exclude<LegacyDaemonCliExport, "runDaemonRestart">, string>>;

const EXPORT_SPEC_RE = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/;

function parseExportAliases(bundleSource: string): Map<string, string> | null {
  const matches = [...bundleSource.matchAll(/export\s*\{([^}]+)\}\s*;?/g)];
  if (matches.length === 0) {
    return null;
  }
  const body = matches.at(-1)?.[1];
  if (!body) {
    return null;
  }

  const aliases = new Map<string, string>();
  for (const chunk of body.split(",")) {
    const spec = chunk.trim();
    if (!spec) {
      continue;
    }
    const parsed = spec.match(EXPORT_SPEC_RE);
    if (!parsed) {
      return null;
    }
    const original = parsed[1];
    const alias = parsed[2] ?? original;
    aliases.set(original, alias);
  }
  return aliases;
}

function resolveLegacyDaemonCliAccessors(bundleSource: string): LegacyDaemonCliAccessors | null {
  const aliases = parseExportAliases(bundleSource);
  if (!aliases) {
    return null;
  }

  const runDaemonInstall = aliases.get("runDaemonInstall");
  const runDaemonRestart = aliases.get("runDaemonRestart");
  const runDaemonStart = aliases.get("runDaemonStart");
  const runDaemonStatus = aliases.get("runDaemonStatus");
  const runDaemonStop = aliases.get("runDaemonStop");
  const runDaemonUninstall = aliases.get("runDaemonUninstall");
  if (!runDaemonRestart) {
    return null;
  }

  const accessors: LegacyDaemonCliAccessors = {
    runDaemonRestart,
  };
  if (runDaemonInstall) {
    accessors.runDaemonInstall = runDaemonInstall;
  }
  if (runDaemonStart) {
    accessors.runDaemonStart = runDaemonStart;
  }
  if (runDaemonStatus) {
    accessors.runDaemonStatus = runDaemonStatus;
  }
  if (runDaemonStop) {
    accessors.runDaemonStop = runDaemonStop;
  }
  if (runDaemonUninstall) {
    accessors.runDaemonUninstall = runDaemonUninstall;
  }
  return accessors;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const cliDir = path.join(distDir, "cli");

const findCandidates = () =>
  fs.readdirSync(distDir).filter((entry) => {
    const isDaemonCliBundle =
      entry === "daemon-cli.js" || entry === "daemon-cli.mjs" || entry.startsWith("daemon-cli-");
    if (!isDaemonCliBundle) {
      return false;
    }
    // tsdown can emit either .js or .mjs depending on bundler settings/runtime.
    return entry.endsWith(".js") || entry.endsWith(".mjs");
  });

// In rare cases, build output can land slightly after this script starts (depending on FS timing).
// Retry briefly to avoid flaky builds.
let candidates = findCandidates();
for (let i = 0; i < 10 && candidates.length === 0; i++) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  candidates = findCandidates();
}

if (candidates.length === 0) {
  throw new Error("No daemon-cli bundle found in dist; cannot write legacy CLI shim.");
}

const orderedCandidates = candidates.toSorted();
const resolved = orderedCandidates
  .map((entry) => {
    const source = fs.readFileSync(path.join(distDir, entry), "utf8");
    const accessors = resolveLegacyDaemonCliAccessors(source);
    return { entry, accessors };
  })
  .find((entry) => Boolean(entry.accessors));

if (!resolved?.accessors) {
  throw new Error(
    `Could not resolve daemon-cli export aliases from dist bundles: ${orderedCandidates.join(", ")}`,
  );
}

const target = resolved.entry;
const relPath = `../${target}`;
const { accessors } = resolved;
const missingExportError = (name: string) =>
  `Legacy daemon CLI export "${name}" is unavailable in this build. Please upgrade CrawClaw.`;
const buildExportLine = (name: (typeof LEGACY_DAEMON_CLI_EXPORTS)[number]) => {
  const accessor = accessors[name];
  if (accessor) {
    return `export const ${name} = daemonCli.${accessor};`;
  }
  return `export const ${name} = async () => { throw new Error(${JSON.stringify(missingExportError(name))}); };`;
};

const contents =
  "// Legacy shim for pre-tsdown update-cli imports.\n" +
  `import * as daemonCli from "${relPath}";\n` +
  LEGACY_DAEMON_CLI_EXPORTS.map(buildExportLine).join("\n") +
  "\n";

fs.mkdirSync(cliDir, { recursive: true });
fs.writeFileSync(path.join(cliDir, "daemon-cli.js"), contents);
