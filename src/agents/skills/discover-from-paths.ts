import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CrawClawConfig } from "../../config/config.js";

const FILE_PATH_PARAM_KEYS = ["path", "file_path", "filePath", "file"] as const;

function realpathOrNull(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function nearestExistingPathStaysInside(params: {
  absolute: string;
  lexicalRoot: string;
  realRoot: string;
}): boolean {
  let cursor = path.resolve(params.absolute);
  while (true) {
    const lexicalRelative = path.relative(params.lexicalRoot, cursor);
    if (!lexicalRelative || lexicalRelative.startsWith("..") || path.isAbsolute(lexicalRelative)) {
      return true;
    }
    const realPath = realpathOrNull(cursor);
    if (realPath) {
      return isPathInsideRoot(params.realRoot, realPath);
    }
    const parent = path.dirname(cursor);
    if (!parent || parent === cursor) {
      return true;
    }
    cursor = parent;
  }
}

function resolveWorkspacePath(candidatePath: string, workspaceDir: string): string | null {
  const normalized = candidatePath.trim();
  if (!normalized) {
    return null;
  }
  const expandedHome = normalized.startsWith("~")
    ? path.join(os.homedir(), normalized.slice(1))
    : normalized;
  const absolute = path.isAbsolute(expandedHome)
    ? path.resolve(expandedHome)
    : path.resolve(workspaceDir, expandedHome);
  const relative = path.relative(workspaceDir, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  const workspaceRealPath = realpathOrNull(workspaceDir) ?? workspaceDir;
  return nearestExistingPathStaysInside({
    absolute,
    lexicalRoot: workspaceDir,
    realRoot: workspaceRealPath,
  })
    ? absolute
    : null;
}

function hasSkillMarkdown(rootDir: string): boolean {
  try {
    const rootSkill = path.join(rootDir, "SKILL.md");
    if (fs.existsSync(rootSkill) && fs.statSync(rootSkill).isFile()) {
      return true;
    }
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }
      const skillMd = path.join(rootDir, entry.name, "SKILL.md");
      if (fs.existsSync(skillMd) && fs.statSync(skillMd).isFile()) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function extractToolCallPaths(toolParams: Record<string, unknown> | undefined): string[] {
  if (!toolParams) {
    return [];
  }
  return FILE_PATH_PARAM_KEYS.flatMap((key) => {
    const value = toolParams[key];
    return typeof value === "string" && value.trim().length > 0 ? [value.trim()] : [];
  });
}

export function discoverDynamicSkillDirsFromPaths(params: {
  workspaceDir: string;
  paths: readonly string[];
}): string[] {
  if (params.paths.length === 0) {
    return [];
  }
  const workspaceDir = path.resolve(params.workspaceDir);
  const workspaceRealPath = realpathOrNull(workspaceDir) ?? workspaceDir;
  const discovered = new Set<string>();
  for (const rawPath of params.paths) {
    const resolvedPath = resolveWorkspacePath(rawPath, workspaceDir);
    if (!resolvedPath) {
      continue;
    }
    const seedDir = (() => {
      try {
        if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
          return resolvedPath;
        }
      } catch {
        // Fall through to dirname for non-existent or inaccessible paths.
      }
      return path.dirname(resolvedPath);
    })();
    let cursor = path.resolve(seedDir);
    while (true) {
      const relative = path.relative(workspaceDir, cursor);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        break;
      }
      const candidates = [path.join(cursor, "skills"), path.join(cursor, ".agents", "skills")];
      for (const candidate of candidates) {
        try {
          if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) {
            continue;
          }
          const candidateRealPath = realpathOrNull(candidate);
          if (!candidateRealPath || !isPathInsideRoot(workspaceRealPath, candidateRealPath)) {
            continue;
          }
          if (hasSkillMarkdown(candidate)) {
            discovered.add(path.resolve(candidate));
          }
        } catch {
          // Ignore inaccessible candidates.
        }
      }
      const parent = path.dirname(cursor);
      if (!parent || parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }
  return Array.from(discovered).toSorted();
}

export function discoverDynamicSkillDirsFromToolCall(params: {
  workspaceDir: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
}): string[] {
  const normalizedToolName = params.toolName?.trim().toLowerCase();
  if (
    normalizedToolName !== "read" &&
    normalizedToolName !== "write" &&
    normalizedToolName !== "edit"
  ) {
    return [];
  }
  return discoverDynamicSkillDirsFromPaths({
    workspaceDir: params.workspaceDir,
    paths: extractToolCallPaths(params.toolParams),
  });
}

export function withDiscoveredSkillExtraDirs(
  config: CrawClawConfig | undefined,
  extraDirs: readonly string[] | undefined,
): CrawClawConfig | undefined {
  const normalized = (extraDirs ?? [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  if (normalized.length === 0) {
    return config;
  }
  const existing = (config?.skills?.load?.extraDirs ?? [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  const merged = [...new Set([...existing, ...normalized])];
  return {
    ...(config ?? {}),
    skills: {
      ...(config?.skills ?? {}),
      load: {
        ...(config?.skills?.load ?? {}),
        extraDirs: merged,
      },
    },
  };
}
