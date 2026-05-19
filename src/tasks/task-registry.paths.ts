import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export function resolveTaskStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CRAWCLAW_STATE_DIR?.trim();
  if (explicit) {
    return resolveStateDir(env);
  }
  return resolveStateDir(env);
}

export function resolveTaskRegistryDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveTaskStateDir(env), "tasks");
}

export function resolveTaskRegistrySqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveTaskRegistryDir(env), "runs.sqlite");
}
