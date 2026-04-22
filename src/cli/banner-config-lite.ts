import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TaglineMode } from "./tagline.js";

function parseTaglineMode(value: unknown): TaglineMode | undefined {
  if (value === "random" || value === "default" || value === "off") {
    return value;
  }
  return undefined;
}

export function readCliBannerTaglineMode(
  env: NodeJS.ProcessEnv = process.env,
): TaglineMode | undefined {
  try {
    const raw = fs.readFileSync(resolveLiteConfigPath(env), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const cli = (parsed as { cli?: unknown }).cli;
    if (!cli || typeof cli !== "object" || Array.isArray(cli)) {
      return undefined;
    }
    const banner = (cli as { banner?: unknown }).banner;
    if (!banner || typeof banner !== "object" || Array.isArray(banner)) {
      return undefined;
    }
    return parseTaglineMode((banner as { taglineMode?: unknown }).taglineMode);
  } catch {
    return undefined;
  }
}

function resolveLiteHome(env: NodeJS.ProcessEnv): string {
  return env.CRAWCLAW_HOME?.trim() || env.HOME?.trim() || os.homedir();
}

function resolveLiteConfigPath(env: NodeJS.ProcessEnv): string {
  const home = resolveLiteHome(env);
  const expandHome = (value: string) =>
    value === "~" || value.startsWith("~/") ? path.join(home, value.slice(2)) : value;
  const explicit = env.CRAWCLAW_CONFIG_PATH?.trim();
  if (explicit) {
    return expandHome(explicit);
  }
  const stateDir = env.CRAWCLAW_STATE_DIR?.trim()
    ? expandHome(env.CRAWCLAW_STATE_DIR.trim())
    : path.join(home, ".crawclaw");
  return path.join(stateDir, "crawclaw.json");
}
