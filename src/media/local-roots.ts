import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { CrawClawConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolvePreferredCrawClawTmpDir } from "../infra/tmp-crawclaw-dir.js";
import { resolveConfigDir } from "../utils.js";

type BuildMediaLocalRootsOptions = {
  preferredTmpDir?: string;
};

let cachedPreferredTmpDir: string | undefined;

function resolveCachedPreferredTmpDir(): string {
  if (!cachedPreferredTmpDir) {
    cachedPreferredTmpDir = resolvePreferredCrawClawTmpDir();
  }
  return cachedPreferredTmpDir;
}

export function buildMediaLocalRoots(
  stateDir: string,
  configDir: string,
  options: BuildMediaLocalRootsOptions = {},
): string[] {
  const resolvedStateDir = path.resolve(stateDir);
  const resolvedConfigDir = path.resolve(configDir);
  const preferredTmpDir = options.preferredTmpDir ?? resolveCachedPreferredTmpDir();
  return Array.from(
    new Set([
      preferredTmpDir,
      path.join(resolvedStateDir, "media"),
      path.join(resolvedStateDir, "workspace"),
      path.join(resolvedStateDir, "sandboxes"),
      // Keep inbound media readable across state-dir/config-dir splits without
      // widening roots beyond the managed media cache.
      path.join(resolvedConfigDir, "media"),
    ]),
  );
}

export function getDefaultMediaLocalRoots(): readonly string[] {
  return buildMediaLocalRoots(resolveStateDir(), resolveConfigDir());
}

export function getAgentScopedMediaLocalRoots(
  cfg: CrawClawConfig,
  agentId?: string,
): readonly string[] {
  const roots = buildMediaLocalRoots(resolveStateDir(), resolveConfigDir());
  if (!agentId?.trim()) {
    return roots;
  }
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  if (!workspaceDir) {
    return roots;
  }
  const normalizedWorkspaceDir = path.resolve(workspaceDir);
  if (!roots.includes(normalizedWorkspaceDir)) {
    roots.push(normalizedWorkspaceDir);
  }
  return roots;
}

export function getAgentScopedMediaLocalRootsForSources({
  cfg,
  agentId,
  mediaSources: _mediaSources,
}: {
  cfg: CrawClawConfig;
  agentId?: string;
  mediaSources?: readonly string[];
}): readonly string[] {
  return getAgentScopedMediaLocalRoots(cfg, agentId);
}
