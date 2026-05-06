import process from "node:process";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";

export type RuntimeKind = "node" | "unknown";
export type NodeSupportLevel = "stable" | "experimental";

type Semver = {
  major: number;
  minor: number;
  patch: number;
};

const STABLE_NODE_MAJOR = 24;
const EXPERIMENTAL_NODE_MAJOR = 25;
const BOUNDED_ENGINE_RE = /^\s*>=\s*v?(\d+\.\d+\.\d+)\s+<\s*v?(\d+)(?:\.\d+\.\d+)?\s*$/i;

type NodeEngineRange = {
  minimum: Semver;
  exclusiveUpperMajor: number;
};

export type RuntimeDetails = {
  kind: RuntimeKind;
  version: string | null;
  execPath: string | null;
  pathEnv: string;
};

const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/;

export function parseSemver(version: string | null): Semver | null {
  if (!version) {
    return null;
  }
  const match = version.match(SEMVER_RE);
  if (!match) {
    return null;
  }
  const [, major, minor, patch] = match;
  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
}

export function isAtLeast(version: Semver | null, minimum: Semver): boolean {
  if (!version) {
    return false;
  }
  if (version.major !== minimum.major) {
    return version.major > minimum.major;
  }
  if (version.minor !== minimum.minor) {
    return version.minor > minimum.minor;
  }
  return version.patch >= minimum.patch;
}

export function detectRuntime(): RuntimeDetails {
  const kind: RuntimeKind = process.versions?.node ? "node" : "unknown";
  const version = process.versions?.node ?? null;

  return {
    kind,
    version,
    execPath: process.execPath ?? null,
    pathEnv: process.env.PATH ?? "(not set)",
  };
}

export function runtimeSatisfies(details: RuntimeDetails): boolean {
  const parsed = parseSemver(details.version);
  if (details.kind === "node") {
    return isSupportedNodeSemver(parsed);
  }
  return false;
}

export function isSupportedNodeVersion(version: string | null): boolean {
  return isSupportedNodeSemver(parseSemver(version));
}

function isSupportedNodeSemver(version: Semver | null): boolean {
  return resolveNodeSupportLevel(version) !== null;
}

export function resolveNodeSupportLevel(version: Semver | string | null): NodeSupportLevel | null {
  const parsed = typeof version === "string" ? parseSemver(version) : version;
  if (!parsed) {
    return null;
  }
  if (parsed.major === STABLE_NODE_MAJOR) {
    return "stable";
  }
  if (parsed.major === EXPERIMENTAL_NODE_MAJOR) {
    return "experimental";
  }
  return null;
}

export function parseNodeEngineRange(engine: string | null): NodeEngineRange | null {
  if (!engine) {
    return null;
  }
  const match = engine.match(BOUNDED_ENGINE_RE);
  if (!match) {
    return null;
  }
  const minimum = parseSemver(match[1] ?? null);
  const exclusiveUpperMajor = Number.parseInt(match[2] ?? "", 10);
  if (!minimum || !Number.isFinite(exclusiveUpperMajor)) {
    return null;
  }
  return {
    minimum,
    exclusiveUpperMajor,
  };
}

export function nodeVersionSatisfiesEngine(
  version: string | null,
  engine: string | null,
): boolean | null {
  const range = parseNodeEngineRange(engine);
  const parsedVersion = parseSemver(version);
  if (!range || !parsedVersion) {
    return null;
  }
  return isAtLeast(parsedVersion, range.minimum) && parsedVersion.major < range.exclusiveUpperMajor;
}

export function assertSupportedRuntime(
  runtime: RuntimeEnv = defaultRuntime,
  details: RuntimeDetails = detectRuntime(),
): void {
  if (runtimeSatisfies(details)) {
    const supportLevel = resolveNodeSupportLevel(details.version);
    if (supportLevel === "experimental") {
      runtime.log(
        [
          `crawclaw is running on experimental Node ${details.version}.`,
          "Node 24.x is the stable runtime. Reinstall native/runtime artifacts if you switch majors.",
        ].join("\n"),
      );
    }
    return;
  }

  const versionLabel = details.version ?? "unknown";
  const runtimeLabel =
    details.kind === "unknown" ? "unknown runtime" : `${details.kind} ${versionLabel}`;
  const execLabel = details.execPath ?? "unknown";

  runtime.error(
    [
      "crawclaw requires Node 24.x or Node 25.x (experimental).",
      `Detected: ${runtimeLabel} (exec: ${execLabel}).`,
      `PATH searched: ${details.pathEnv}`,
      "Install Node: https://nodejs.org/en/download",
      "Upgrade Node and re-run crawclaw.",
    ].join("\n"),
  );
  runtime.exit(1);
}
