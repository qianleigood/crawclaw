import path, { posix } from "node:path";
import { resolvePathViaExistingAncestorSync } from "../../infra/boundary-path.js";
import { normalizeWindowsPathForComparison } from "../../infra/path-guards.js";

export type SandboxHostPathKind = "posix" | "windows-drive" | "windows-unc" | "relative";

const WINDOWS_DRIVE_ABS_PATH_RE = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_PATH_RE = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

function stripWindowsNamespacePrefix(input: string): string {
  if (input.startsWith("\\\\?\\")) {
    const withoutPrefix = input.slice(4);
    if (withoutPrefix.toUpperCase().startsWith("UNC\\")) {
      return `\\\\${withoutPrefix.slice(4)}`;
    }
    return withoutPrefix;
  }
  if (input.startsWith("//?/")) {
    const withoutPrefix = input.slice(4);
    if (withoutPrefix.toUpperCase().startsWith("UNC/")) {
      return `//${withoutPrefix.slice(4)}`;
    }
    return withoutPrefix;
  }
  return input;
}

/**
 * Normalize a POSIX host path: resolve `.`, `..`, collapse `//`, strip trailing `/`.
 */
export function normalizeSandboxHostPath(raw: string): string {
  const trimmed = stripWindowsNamespacePrefix(raw.trim());
  if (!trimmed) {
    return "/";
  }
  const kind = getSandboxHostPathKind(trimmed);
  if (kind === "windows-drive" || kind === "windows-unc") {
    let normalized = path.win32.normalize(trimmed).replaceAll("/", "\\");
    if (/^[A-Za-z]:\\?$/.test(normalized)) {
      return `${normalized.slice(0, 2)}\\`;
    }
    normalized = normalized.replace(/\\+$/, "");
    return kind === "windows-drive"
      ? `${normalized[0].toUpperCase()}${normalized.slice(1)}`
      : normalized;
  }
  const normalized = posix.normalize(trimmed.replaceAll("\\", "/"));
  return normalized.replace(/\/+$/, "") || "/";
}

export function getSandboxHostPathKind(raw: string): SandboxHostPathKind {
  const trimmed = stripWindowsNamespacePrefix(raw.trim());
  if (WINDOWS_DRIVE_ABS_PATH_RE.test(trimmed)) {
    return "windows-drive";
  }
  if (WINDOWS_UNC_PATH_RE.test(trimmed)) {
    return "windows-unc";
  }
  return trimmed.startsWith("/") ? "posix" : "relative";
}

export function isSandboxHostPathAbsolute(raw: string): boolean {
  return getSandboxHostPathKind(raw) !== "relative";
}

export function isSandboxHostPathNetwork(raw: string): boolean {
  return getSandboxHostPathKind(raw) === "windows-unc";
}

export function isSandboxHostPathInside(root: string, target: string): boolean {
  const rootKind = getSandboxHostPathKind(root);
  const targetKind = getSandboxHostPathKind(target);
  if ((rootKind === "windows-drive" || rootKind === "windows-unc") && rootKind === targetKind) {
    const rootForCompare = normalizeWindowsPathForComparison(root);
    const targetForCompare = normalizeWindowsPathForComparison(target);
    const relative = path.win32.relative(rootForCompare, targetForCompare);
    return relative === "" || (!relative.startsWith("..") && !path.win32.isAbsolute(relative));
  }

  const resolvedRoot = posix.resolve(normalizeSandboxHostPath(root));
  const resolvedTarget = posix.resolve(normalizeSandboxHostPath(target));
  const relative = posix.relative(resolvedRoot, resolvedTarget);
  return relative === "" || (!relative.startsWith("..") && !posix.isAbsolute(relative));
}

/**
 * Resolve a path through the deepest existing ancestor so parent symlinks are honored
 * even when the final source leaf does not exist yet.
 */
export function resolveSandboxHostPathViaExistingAncestor(sourcePath: string): string {
  const kind = getSandboxHostPathKind(sourcePath);
  if (kind === "relative") {
    return sourcePath;
  }
  if ((kind === "windows-drive" || kind === "windows-unc") && process.platform !== "win32") {
    return normalizeSandboxHostPath(sourcePath);
  }
  return normalizeSandboxHostPath(resolvePathViaExistingAncestorSync(sourcePath));
}
