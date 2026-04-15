import path from "node:path";
import type { CrawClawConfig } from "../config/config.js";
import { resolveGatewayPort } from "../config/paths.js";
import type { BrowserConfig, BrowserProfileConfig } from "../config/types.browser.js";
import {
  DEFAULT_BROWSER_CONTROL_PORT,
  deriveDefaultBrowserCdpPortRange,
  deriveDefaultBrowserControlPort,
} from "../config/port-defaults.js";
import { resolveGatewayAuth } from "../gateway/auth.js";
import { isLoopbackHost } from "../gateway/net.js";
import type { SsrFPolicy } from "../infra/net/ssrf.js";
import { resolvePreferredCrawClawTmpDir } from "../infra/tmp-crawclaw-dir.js";
import { redactSensitiveText } from "../logging/redact.js";
import { resolveUserPath } from "../utils.js";
import {
  ensureDefaultProfile,
  ensureDefaultUserBrowserProfile,
  normalizeHexColor,
  normalizeTimeoutMs,
  parseBrowserHttpUrl,
  resolveBrowserSsrFPolicy,
  resolveCdpPortRangeStart,
} from "./browser-config-helpers.js";

export const DEFAULT_CRAWCLAW_BROWSER_ENABLED = true;
export const DEFAULT_BROWSER_EVALUATE_ENABLED = true;
export const DEFAULT_CRAWCLAW_BROWSER_COLOR = "#FF4500";
export const DEFAULT_CRAWCLAW_BROWSER_PROFILE_NAME = "crawclaw";
export const DEFAULT_BROWSER_DEFAULT_PROFILE_NAME = "crawclaw";
export const DEFAULT_AI_SNAPSHOT_MAX_CHARS = 80_000;

const DEFAULT_FALLBACK_BROWSER_TMP_DIR = "/tmp/crawclaw";
const CDP_PORT_RANGE_START = 18800;

function canUseNodeFs(): boolean {
  const getBuiltinModule = (
    process as NodeJS.Process & {
      getBuiltinModule?: (id: string) => unknown;
    }
  ).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return false;
  }
  try {
    return getBuiltinModule("fs") !== undefined;
  } catch {
    return false;
  }
}

const DEFAULT_BROWSER_TMP_DIR = canUseNodeFs()
  ? resolvePreferredCrawClawTmpDir()
  : DEFAULT_FALLBACK_BROWSER_TMP_DIR;

export const DEFAULT_UPLOAD_DIR = path.join(DEFAULT_BROWSER_TMP_DIR, "uploads");

export type BrowserControlAuth = {
  token?: string;
  password?: string;
};

export type ResolvedBrowserConfig = {
  enabled: boolean;
  evaluateEnabled: boolean;
  controlPort: number;
  cdpPortRangeStart: number;
  cdpPortRangeEnd: number;
  cdpProtocol: "http" | "https";
  cdpHost: string;
  cdpIsLoopback: boolean;
  remoteCdpTimeoutMs: number;
  remoteCdpHandshakeTimeoutMs: number;
  color: string;
  executablePath?: string;
  headless: boolean;
  noSandbox: boolean;
  attachOnly: boolean;
  defaultProfile: string;
  profiles: Record<string, BrowserProfileConfig>;
  ssrfPolicy?: SsrFPolicy;
  extraArgs: string[];
};

export type ResolvedBrowserProfile = {
  name: string;
  cdpPort: number;
  cdpUrl: string;
  cdpHost: string;
  cdpIsLoopback: boolean;
  userDataDir?: string;
  color: string;
  driver: "crawclaw" | "existing-session";
  attachOnly: boolean;
};

export { parseBrowserHttpUrl } from "./browser-config-helpers.js";

export function resolveBrowserConfig(
  cfg: BrowserConfig | undefined,
  rootConfig?: CrawClawConfig,
): ResolvedBrowserConfig {
  const enabled = cfg?.enabled ?? DEFAULT_CRAWCLAW_BROWSER_ENABLED;
  const evaluateEnabled = cfg?.evaluateEnabled ?? DEFAULT_BROWSER_EVALUATE_ENABLED;
  const gatewayPort = resolveGatewayPort(rootConfig);
  const controlPort = deriveDefaultBrowserControlPort(gatewayPort ?? DEFAULT_BROWSER_CONTROL_PORT);
  const defaultColor = normalizeHexColor(cfg?.color, DEFAULT_CRAWCLAW_BROWSER_COLOR);
  const remoteCdpTimeoutMs = normalizeTimeoutMs(cfg?.remoteCdpTimeoutMs, 1500);
  const remoteCdpHandshakeTimeoutMs = normalizeTimeoutMs(
    cfg?.remoteCdpHandshakeTimeoutMs,
    Math.max(2000, remoteCdpTimeoutMs * 2),
  );

  const derivedCdpRange = deriveDefaultBrowserCdpPortRange(controlPort);
  const cdpRangeSpan = derivedCdpRange.end - derivedCdpRange.start;
  const cdpPortRangeStart = resolveCdpPortRangeStart(
    cfg?.cdpPortRangeStart,
    derivedCdpRange.start,
    cdpRangeSpan,
  );
  const cdpPortRangeEnd = cdpPortRangeStart + cdpRangeSpan;

  const rawCdpUrl = (cfg?.cdpUrl ?? "").trim();
  let cdpInfo:
    | {
        parsed: URL;
        port: number;
        normalized: string;
      }
    | undefined;
  if (rawCdpUrl) {
    cdpInfo = parseBrowserHttpUrl(rawCdpUrl, "browser.cdpUrl");
  } else {
    const derivedPort = controlPort + 1;
    if (derivedPort > 65535) {
      throw new Error(
        `Derived CDP port (${derivedPort}) is too high; check gateway port configuration.`,
      );
    }
    const derived = new URL(`http://127.0.0.1:${derivedPort}`);
    cdpInfo = {
      parsed: derived,
      port: derivedPort,
      normalized: derived.toString().replace(/\/$/, ""),
    };
  }

  const headless = cfg?.headless === true;
  const noSandbox = cfg?.noSandbox === true;
  const attachOnly = cfg?.attachOnly === true;
  const executablePath = cfg?.executablePath?.trim() || undefined;

  const defaultProfileFromConfig = cfg?.defaultProfile?.trim() || undefined;
  const legacyCdpPort = rawCdpUrl ? cdpInfo.port : undefined;
  const isWsUrl = cdpInfo.parsed.protocol === "ws:" || cdpInfo.parsed.protocol === "wss:";
  const legacyCdpUrl = rawCdpUrl && isWsUrl ? cdpInfo.normalized : undefined;
  const profiles = ensureDefaultUserBrowserProfile(
    ensureDefaultProfile({
      profiles: cfg?.profiles,
      defaultProfileName: DEFAULT_CRAWCLAW_BROWSER_PROFILE_NAME,
      defaultColor,
      legacyCdpPort,
      fallbackCdpPort: cdpPortRangeStart ?? CDP_PORT_RANGE_START,
      legacyCdpUrl,
    }),
  );
  const cdpProtocol = cdpInfo.parsed.protocol === "https:" ? "https" : "http";

  const defaultProfile =
    defaultProfileFromConfig ??
    (profiles[DEFAULT_BROWSER_DEFAULT_PROFILE_NAME]
      ? DEFAULT_BROWSER_DEFAULT_PROFILE_NAME
      : profiles[DEFAULT_CRAWCLAW_BROWSER_PROFILE_NAME]
        ? DEFAULT_CRAWCLAW_BROWSER_PROFILE_NAME
        : "user");

  const extraArgs = Array.isArray(cfg?.extraArgs)
    ? cfg.extraArgs.filter((a): a is string => typeof a === "string" && a.trim().length > 0)
    : [];
  const ssrfPolicy = resolveBrowserSsrFPolicy(cfg);
  return {
    enabled,
    evaluateEnabled,
    controlPort,
    cdpPortRangeStart,
    cdpPortRangeEnd,
    cdpProtocol,
    cdpHost: cdpInfo.parsed.hostname,
    cdpIsLoopback: isLoopbackHost(cdpInfo.parsed.hostname),
    remoteCdpTimeoutMs,
    remoteCdpHandshakeTimeoutMs,
    color: defaultColor,
    executablePath,
    headless,
    noSandbox,
    attachOnly,
    defaultProfile,
    profiles,
    ssrfPolicy,
    extraArgs,
  };
}

export function resolveProfile(
  resolved: ResolvedBrowserConfig,
  profileName: string,
): ResolvedBrowserProfile | null {
  const profile = resolved.profiles[profileName];
  if (!profile) {
    return null;
  }

  const rawProfileUrl = profile.cdpUrl?.trim() ?? "";
  let cdpHost = resolved.cdpHost;
  let cdpPort = profile.cdpPort ?? 0;
  let cdpUrl = "";
  const driver = profile.driver === "existing-session" ? "existing-session" : "crawclaw";

  if (driver === "existing-session") {
    return {
      name: profileName,
      cdpPort: 0,
      cdpUrl: "",
      cdpHost: "",
      cdpIsLoopback: true,
      userDataDir: resolveUserPath(profile.userDataDir?.trim() || "") || undefined,
      color: profile.color,
      driver,
      attachOnly: true,
    };
  }

  const hasStaleWsPath =
    rawProfileUrl !== "" &&
    cdpPort > 0 &&
    /^wss?:\/\//i.test(rawProfileUrl) &&
    /\/devtools\/browser\//i.test(rawProfileUrl);

  if (hasStaleWsPath) {
    const parsed = new URL(rawProfileUrl);
    cdpHost = parsed.hostname;
    cdpUrl = `${resolved.cdpProtocol}://${cdpHost}:${cdpPort}`;
  } else if (rawProfileUrl) {
    const parsed = parseBrowserHttpUrl(rawProfileUrl, `browser.profiles.${profileName}.cdpUrl`);
    cdpHost = parsed.parsed.hostname;
    cdpPort = parsed.port;
    cdpUrl = parsed.normalized;
  } else if (cdpPort) {
    cdpUrl = `${resolved.cdpProtocol}://${resolved.cdpHost}:${cdpPort}`;
  } else {
    throw new Error(`Profile "${profileName}" must define cdpPort or cdpUrl.`);
  }

  return {
    name: profileName,
    cdpPort,
    cdpUrl,
    cdpHost,
    cdpIsLoopback: isLoopbackHost(cdpHost),
    color: profile.color,
    driver,
    attachOnly: profile.attachOnly ?? resolved.attachOnly,
  };
}

export function resolveBrowserControlAuth(
  cfg: CrawClawConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): BrowserControlAuth {
  const auth = resolveGatewayAuth({
    authConfig: cfg?.gateway?.auth,
    env,
    tailscaleMode: cfg?.gateway?.tailscale?.mode,
  });
  const token = typeof auth.token === "string" ? auth.token.trim() : "";
  const password = typeof auth.password === "string" ? auth.password.trim() : "";
  return {
    token: token || undefined,
    password: password || undefined,
  };
}

export function redactCdpUrl(cdpUrl: string | null | undefined): string | null | undefined {
  if (typeof cdpUrl !== "string") {
    return cdpUrl;
  }
  const trimmed = cdpUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    parsed.username = "";
    parsed.password = "";
    return redactSensitiveText(parsed.toString().replace(/\/$/, ""));
  } catch {
    return redactSensitiveText(trimmed);
  }
}
