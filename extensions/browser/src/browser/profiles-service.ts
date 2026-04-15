import fs from "node:fs";
import path from "node:path";
import type { BrowserProfileConfig, CrawClawConfig } from "../config/config.js";
import { loadConfig, writeConfigFile } from "../config/config.js";
import { deriveDefaultBrowserCdpPortRange } from "../config/port-defaults.js";
import { resolveCrawClawUserDataDir } from "./chrome.js";
import { resolveProfile } from "./config.js";
import {
  BrowserConflictError,
  BrowserProfileNotFoundError,
  BrowserResourceExhaustedError,
  BrowserValidationError,
} from "./errors.js";
import {
  allocateCdpPort,
  allocateColor,
  getUsedColors,
  getUsedPorts,
  isValidProfileName,
} from "./profiles.js";
import type { BrowserRouteContext, ProfileStatus } from "./server-context.types.js";
import { movePathToTrash } from "./trash.js";

export type CreateProfileParams = {
  name: string;
  color?: string;
};

export type CreateProfileResult = {
  ok: true;
  profile: string;
  transport: "pinchtab";
  cdpPort: number | null;
  cdpUrl: string | null;
  color: string;
  isRemote: boolean;
};

export type DeleteProfileResult = {
  ok: true;
  profile: string;
  deleted: boolean;
};

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

const cdpPortRange = (resolved: {
  controlPort: number;
  cdpPortRangeStart?: number;
  cdpPortRangeEnd?: number;
}): { start: number; end: number } => {
  const start = resolved.cdpPortRangeStart;
  const end = resolved.cdpPortRangeEnd;
  if (
    typeof start === "number" &&
    Number.isFinite(start) &&
    Number.isInteger(start) &&
    typeof end === "number" &&
    Number.isFinite(end) &&
    Number.isInteger(end) &&
    start > 0 &&
    end >= start &&
    end <= 65535
  ) {
    return { start, end };
  }

  return deriveDefaultBrowserCdpPortRange(resolved.controlPort);
};

export function createBrowserProfilesService(ctx: BrowserRouteContext) {
  const listProfiles = async (): Promise<ProfileStatus[]> => {
    return await ctx.listProfiles();
  };

  const createProfile = async (params: CreateProfileParams): Promise<CreateProfileResult> => {
    const name = params.name.trim();
    if (!isValidProfileName(name)) {
      throw new BrowserValidationError(
        "invalid profile name: use lowercase letters, numbers, and hyphens only",
      );
    }

    const state = ctx.state();
    const resolvedProfiles = state.resolved.profiles;
    if (name in resolvedProfiles) {
      throw new BrowserConflictError(`profile "${name}" already exists`);
    }

    const cfg = loadConfig();
    const rawProfiles = cfg.browser?.profiles ?? {};
    if (name in rawProfiles) {
      throw new BrowserConflictError(`profile "${name}" already exists`);
    }

    const usedColors = getUsedColors(resolvedProfiles);
    const profileColor =
      params.color && HEX_COLOR_RE.test(params.color) ? params.color : allocateColor(usedColors);

    let profileConfig: BrowserProfileConfig;
    {
      const usedPorts = getUsedPorts(resolvedProfiles);
      const range = cdpPortRange(state.resolved);
      const cdpPort = allocateCdpPort(usedPorts, range);
      if (cdpPort === null) {
        throw new BrowserResourceExhaustedError("no available CDP ports in range");
      }
      profileConfig = {
        cdpPort,
        color: profileColor,
      };
    }

    const nextConfig: CrawClawConfig = {
      ...cfg,
      browser: {
        ...cfg.browser,
        profiles: {
          ...rawProfiles,
          [name]: profileConfig,
        },
      },
    };

    await writeConfigFile(nextConfig);

    state.resolved.profiles[name] = profileConfig;
    const resolved = resolveProfile(state.resolved, name);
    if (!resolved) {
      throw new BrowserProfileNotFoundError(`profile "${name}" not found after creation`);
    }
    return {
      ok: true,
      profile: name,
      transport: "pinchtab",
      cdpPort: null,
      cdpUrl: null,
      color: resolved.color,
      isRemote: false,
    };
  };

  const deleteProfile = async (nameRaw: string): Promise<DeleteProfileResult> => {
    const name = nameRaw.trim();
    if (!name) {
      throw new BrowserValidationError("profile name is required");
    }
    if (!isValidProfileName(name)) {
      throw new BrowserValidationError("invalid profile name");
    }

    const state = ctx.state();
    const cfg = loadConfig();
    const profiles = cfg.browser?.profiles ?? {};
    const defaultProfile = cfg.browser?.defaultProfile ?? state.resolved.defaultProfile;
    if (name === defaultProfile) {
      throw new BrowserValidationError(
        `cannot delete the default profile "${name}"; change browser.defaultProfile first`,
      );
    }
    if (!(name in profiles)) {
      throw new BrowserProfileNotFoundError(`profile "${name}" not found`);
    }

    let deleted = false;
    const resolved = resolveProfile(state.resolved, name);

    if (resolved?.cdpIsLoopback && resolved.driver === "crawclaw") {
      try {
        await ctx.forProfile(name).stopRunningBrowser();
      } catch {
        // ignore
      }

      const userDataDir = resolveCrawClawUserDataDir(name);
      const profileDir = path.dirname(userDataDir);
      if (fs.existsSync(profileDir)) {
        await movePathToTrash(profileDir);
        deleted = true;
      }
    }

    const { [name]: _removed, ...remainingProfiles } = profiles;
    const nextConfig: CrawClawConfig = {
      ...cfg,
      browser: {
        ...cfg.browser,
        profiles: remainingProfiles,
      },
    };

    await writeConfigFile(nextConfig);

    delete state.resolved.profiles[name];
    state.profiles.delete(name);

    return { ok: true, profile: name, deleted };
  };

  return {
    listProfiles,
    createProfile,
    deleteProfile,
  };
}
