import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CrawClawConfig } from "../../config/config.js";

const MAX_PROMPT_PATH_TOKENS = 20;
const PATH_TOKEN_REGEX = /(?:["'`])([^"'`\n]{1,320})(?:["'`])|([^\s"'`]{1,320})/g;

function normalizeToken(raw: string): string {
  return raw.trim().replace(/[),.:;!?]+$/g, "");
}

function isLikelyLocalPathToken(token: string): boolean {
  if (!token) {
    return false;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(token)) {
    return false;
  }
  if (token.startsWith("mcp://") || token.startsWith("plugin://") || token.startsWith("app://")) {
    return false;
  }
  if (
    !token.includes("/") &&
    !token.includes("\\") &&
    !token.startsWith(".") &&
    !token.startsWith("~")
  ) {
    return false;
  }
  return true;
}

function resolvePromptPathToken(token: string, workspaceDir: string): string | null {
  const normalized = normalizeToken(token);
  if (!isLikelyLocalPathToken(normalized)) {
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
  return absolute;
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

export function discoverDynamicSkillDirsFromPrompt(params: {
  workspaceDir: string;
  prompt?: string;
}): string[] {
  const prompt = params.prompt?.trim();
  if (!prompt) {
    return [];
  }
  const workspaceDir = path.resolve(params.workspaceDir);
  const seenTokens = new Set<string>();
  const resolvedPaths: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = PATH_TOKEN_REGEX.exec(prompt)) !== null) {
    const token = normalizeToken(match[1] ?? match[2] ?? "");
    if (!token || seenTokens.has(token)) {
      continue;
    }
    seenTokens.add(token);
    const absolute = resolvePromptPathToken(token, workspaceDir);
    if (!absolute) {
      continue;
    }
    resolvedPaths.push(absolute);
    if (resolvedPaths.length >= MAX_PROMPT_PATH_TOKENS) {
      break;
    }
  }
  if (resolvedPaths.length === 0) {
    return [];
  }

  const discovered = new Set<string>();
  for (const resolvedPath of resolvedPaths) {
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
          if (hasSkillMarkdown(candidate)) {
            discovered.add(path.resolve(candidate));
          }
        } catch {
          // Ignore inaccessible skill candidates.
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

export function withDynamicSkillExtraDirs(
  config: CrawClawConfig | undefined,
  extraDirs: string[] | undefined,
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
