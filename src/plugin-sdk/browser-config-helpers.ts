import type { BrowserConfig, BrowserProfileConfig } from "../config/types.browser.js";
import type { SsrFPolicy } from "../infra/net/ssrf.js";

export function normalizeHexColor(raw: string | undefined, fallback: string) {
  const value = (raw ?? "").trim();
  if (!value) {
    return fallback;
  }
  const normalized = value.startsWith("#") ? value : `#${value}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    return fallback;
  }
  return normalized.toUpperCase();
}

export function normalizeTimeoutMs(raw: number | undefined, fallback: number) {
  const value = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : fallback;
  return value < 0 ? fallback : value;
}

export function resolveCdpPortRangeStart(
  rawStart: number | undefined,
  fallbackStart: number,
  rangeSpan: number,
) {
  const start =
    typeof rawStart === "number" && Number.isFinite(rawStart)
      ? Math.floor(rawStart)
      : fallbackStart;
  if (start < 1 || start > 65535) {
    throw new Error(`browser.cdpPortRangeStart must be between 1 and 65535, got: ${start}`);
  }
  const maxStart = 65535 - rangeSpan;
  if (start > maxStart) {
    throw new Error(
      `browser.cdpPortRangeStart (${start}) is too high for a ${rangeSpan + 1}-port range; max is ${maxStart}.`,
    );
  }
  return start;
}

function normalizeStringList(raw: string[] | undefined): string[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const values = raw
    .map((value) => value.trim())
    .filter((value): value is string => value.length > 0);
  return values.length > 0 ? values : undefined;
}

export function resolveBrowserSsrFPolicy(cfg: BrowserConfig | undefined): SsrFPolicy | undefined {
  const allowPrivateNetwork = cfg?.ssrfPolicy?.allowPrivateNetwork;
  const dangerouslyAllowPrivateNetwork = cfg?.ssrfPolicy?.dangerouslyAllowPrivateNetwork;
  const allowedHostnames = normalizeStringList(cfg?.ssrfPolicy?.allowedHostnames);
  const hostnameAllowlist = normalizeStringList(cfg?.ssrfPolicy?.hostnameAllowlist);
  const hasExplicitPrivateSetting =
    allowPrivateNetwork !== undefined || dangerouslyAllowPrivateNetwork !== undefined;
  const resolvedAllowPrivateNetwork =
    dangerouslyAllowPrivateNetwork === true ||
    allowPrivateNetwork === true ||
    !hasExplicitPrivateSetting;

  if (
    !resolvedAllowPrivateNetwork &&
    !hasExplicitPrivateSetting &&
    !allowedHostnames &&
    !hostnameAllowlist
  ) {
    return undefined;
  }

  return {
    ...(resolvedAllowPrivateNetwork ? { dangerouslyAllowPrivateNetwork: true } : {}),
    ...(allowedHostnames ? { allowedHostnames } : {}),
    ...(hostnameAllowlist ? { hostnameAllowlist } : {}),
  };
}

export function parseBrowserHttpUrl(raw: string, label: string) {
  const trimmed = raw.trim();
  const parsed = new URL(trimmed);
  const allowed = ["http:", "https:", "ws:", "wss:"];
  if (!allowed.includes(parsed.protocol)) {
    throw new Error(`${label} must be http(s) or ws(s), got: ${parsed.protocol.replace(":", "")}`);
  }

  const isSecure = parsed.protocol === "https:" || parsed.protocol === "wss:";
  const port =
    parsed.port && Number.parseInt(parsed.port, 10) > 0
      ? Number.parseInt(parsed.port, 10)
      : isSecure
        ? 443
        : 80;

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`${label} has invalid port: ${parsed.port}`);
  }

  return {
    parsed,
    port,
    normalized: parsed.toString().replace(/\/$/, ""),
  };
}

export function ensureDefaultProfile(params: {
  profiles: Record<string, BrowserProfileConfig> | undefined;
  defaultProfileName: string;
  defaultColor: string;
  fallbackCdpPort: number;
  legacyCdpPort?: number;
  legacyCdpUrl?: string;
}): Record<string, BrowserProfileConfig> {
  const result = { ...params.profiles };
  if (!result[params.defaultProfileName]) {
    result[params.defaultProfileName] = {
      cdpPort: params.legacyCdpPort ?? params.fallbackCdpPort,
      color: params.defaultColor,
      ...(params.legacyCdpUrl ? { cdpUrl: params.legacyCdpUrl } : {}),
    };
  }
  return result;
}

export function ensureDefaultUserBrowserProfile(
  profiles: Record<string, BrowserProfileConfig>,
): Record<string, BrowserProfileConfig> {
  const result = { ...profiles };
  if (result.user) {
    return result;
  }
  result.user = {
    driver: "existing-session",
    attachOnly: true,
    color: "#00AA00",
  };
  return result;
}
