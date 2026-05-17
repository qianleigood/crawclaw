import { randomUUID } from "node:crypto";
import type { CrawClawConfig } from "../config/config.js";
import {
  loadConfig,
  resolveConfigPath,
  resolveGatewayPort,
  resolveStateDir,
} from "../config/config.js";
import { loadConfig as loadConfigFromIo } from "../config/io.js";
import {
  resolveConfigPath as resolveConfigPathFromPaths,
  resolveGatewayPort as resolveGatewayPortFromPaths,
  resolveStateDir as resolveStateDirFromPaths,
} from "../config/paths.js";
import { resolveSecretInputRef } from "../config/types.secrets.js";
import { loadGatewayTlsRuntime } from "../infra/tls/gateway.js";
import { resolveSecretInputString } from "../secrets/resolve-secret-input-string.js";
import type { GatewayClientMode, GatewayClientName } from "../utils/gateway-client-surface.js";
import {
  buildGatewayConnectionDetailsWithResolvers,
  type GatewayConnectionDetails,
} from "./connection-details.js";
import {
  GatewaySecretRefUnavailableError,
  resolveGatewayCredentialsFromConfig,
  trimToUndefined,
  type GatewayCredentialMode,
  type GatewayCredentialPrecedence,
  type GatewayRemoteCredentialFallback,
  type GatewayRemoteCredentialPrecedence,
} from "./credentials.js";
import { defaultGatewayHttpFetch } from "./http-fetch.js";
import type { OperatorScope } from "./method-scopes.js";
export type { GatewayConnectionDetails };

const GATEWAY_TOKEN_HEADER = "x-crawclaw-gateway-token";

type CallGatewayBaseOptions = {
  url?: string;
  token?: string;
  password?: string;
  tlsFingerprint?: string;
  config?: CrawClawConfig;
  method: string;
  params?: unknown;
  expectFinal?: boolean;
  timeoutMs?: number;
  clientName?: GatewayClientName;
  clientDisplayName?: string;
  clientVersion?: string;
  platform?: string;
  mode?: GatewayClientMode;
  instanceId?: string;
  minProtocol?: number;
  maxProtocol?: number;
  requiredMethods?: string[];
  /**
   * Overrides the config path shown in connection error details.
   * Does not affect config loading; callers still control auth via opts.token/password/env/config.
   */
  configPath?: string;
};

export type CallGatewayScopedOptions = CallGatewayBaseOptions & {
  scopes: OperatorScope[];
};

export type CallGatewayCliOptions = CallGatewayBaseOptions & {
  scopes?: OperatorScope[];
};

export type CallGatewayOptions = CallGatewayBaseOptions & {
  scopes?: OperatorScope[];
};

const defaultGatewayCallDeps = {
  fetch: defaultGatewayHttpFetch,
  loadConfig,
  resolveGatewayPort,
  resolveConfigPath,
  resolveStateDir,
  loadGatewayTlsRuntime,
};
const gatewayCallDeps = {
  ...defaultGatewayCallDeps,
};

function loadGatewayConfig(): CrawClawConfig {
  const loadConfigFn =
    typeof gatewayCallDeps.loadConfig === "function"
      ? gatewayCallDeps.loadConfig
      : typeof defaultGatewayCallDeps.loadConfig === "function"
        ? defaultGatewayCallDeps.loadConfig
        : loadConfigFromIo;
  return loadConfigFn();
}

function resolveGatewayStateDir(env: NodeJS.ProcessEnv): string {
  const resolveStateDirFn =
    typeof gatewayCallDeps.resolveStateDir === "function"
      ? gatewayCallDeps.resolveStateDir
      : resolveStateDirFromPaths;
  return resolveStateDirFn(env);
}

function resolveGatewayConfigPath(env: NodeJS.ProcessEnv): string {
  const resolveConfigPathFn =
    typeof gatewayCallDeps.resolveConfigPath === "function"
      ? gatewayCallDeps.resolveConfigPath
      : resolveConfigPathFromPaths;
  return resolveConfigPathFn(env, resolveGatewayStateDir(env));
}

function resolveGatewayPortValue(config?: CrawClawConfig, env?: NodeJS.ProcessEnv): number {
  const resolveGatewayPortFn =
    typeof gatewayCallDeps.resolveGatewayPort === "function"
      ? gatewayCallDeps.resolveGatewayPort
      : resolveGatewayPortFromPaths;
  return resolveGatewayPortFn(config, env);
}

export function buildGatewayConnectionDetails(
  options: {
    config?: CrawClawConfig;
    url?: string;
    configPath?: string;
    urlSource?: "cli" | "env";
  } = {},
): GatewayConnectionDetails {
  return buildGatewayConnectionDetailsWithResolvers(options, {
    loadConfig: () => loadGatewayConfig(),
    resolveConfigPath: (env) => resolveGatewayConfigPath(env),
    resolveGatewayPort: (config, env) => resolveGatewayPortValue(config, env),
  });
}

export const __testing = {
  setDepsForTests(deps: Partial<typeof defaultGatewayCallDeps> | undefined): void {
    gatewayCallDeps.fetch = deps?.fetch ?? defaultGatewayCallDeps.fetch;
    gatewayCallDeps.loadConfig = deps?.loadConfig ?? defaultGatewayCallDeps.loadConfig;
    gatewayCallDeps.resolveGatewayPort =
      deps?.resolveGatewayPort ?? defaultGatewayCallDeps.resolveGatewayPort;
    gatewayCallDeps.resolveConfigPath =
      deps?.resolveConfigPath ?? defaultGatewayCallDeps.resolveConfigPath;
    gatewayCallDeps.resolveStateDir =
      deps?.resolveStateDir ?? defaultGatewayCallDeps.resolveStateDir;
    gatewayCallDeps.loadGatewayTlsRuntime =
      deps?.loadGatewayTlsRuntime ?? defaultGatewayCallDeps.loadGatewayTlsRuntime;
  },
  resetDepsForTests(): void {
    gatewayCallDeps.fetch = defaultGatewayCallDeps.fetch;
    gatewayCallDeps.loadConfig = defaultGatewayCallDeps.loadConfig;
    gatewayCallDeps.resolveGatewayPort = defaultGatewayCallDeps.resolveGatewayPort;
    gatewayCallDeps.resolveConfigPath = defaultGatewayCallDeps.resolveConfigPath;
    gatewayCallDeps.resolveStateDir = defaultGatewayCallDeps.resolveStateDir;
    gatewayCallDeps.loadGatewayTlsRuntime = defaultGatewayCallDeps.loadGatewayTlsRuntime;
  },
};

export type ExplicitGatewayAuth = {
  token?: string;
  password?: string;
};

export function resolveExplicitGatewayAuth(opts?: ExplicitGatewayAuth): ExplicitGatewayAuth {
  const token =
    typeof opts?.token === "string" && opts.token.trim().length > 0 ? opts.token.trim() : undefined;
  const password =
    typeof opts?.password === "string" && opts.password.trim().length > 0
      ? opts.password.trim()
      : undefined;
  return { token, password };
}

export function ensureExplicitGatewayAuth(params: {
  urlOverride?: string;
  urlOverrideSource?: "cli" | "env";
  explicitAuth?: ExplicitGatewayAuth;
  resolvedAuth?: ExplicitGatewayAuth;
  errorHint: string;
  configPath?: string;
}): void {
  if (!params.urlOverride) {
    return;
  }
  // URL overrides are untrusted redirects and can move WebSocket traffic off the intended host.
  // Never allow an override to silently reuse implicit credentials.
  const explicitToken = params.explicitAuth?.token;
  const explicitPassword = params.explicitAuth?.password;
  if (params.urlOverrideSource === "cli" && (explicitToken || explicitPassword)) {
    return;
  }
  const hasResolvedAuth =
    params.resolvedAuth?.token ||
    params.resolvedAuth?.password ||
    explicitToken ||
    explicitPassword;
  // Env overrides are supported for deployment ergonomics, but only when explicit auth is available.
  if (params.urlOverrideSource === "env" && hasResolvedAuth) {
    return;
  }
  const message = [
    "gateway url override requires explicit credentials",
    params.errorHint,
    params.configPath ? `Config: ${params.configPath}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  throw new Error(message);
}

type GatewayRemoteSettings = {
  url?: string;
  token?: string;
  password?: string;
  tlsFingerprint?: string;
};

type ResolvedGatewayCallContext = {
  config: CrawClawConfig;
  configPath: string;
  isRemoteMode: boolean;
  remote?: GatewayRemoteSettings;
  urlOverride?: string;
  urlOverrideSource?: "cli" | "env";
  remoteUrl?: string;
  explicitAuth: ExplicitGatewayAuth;
  modeOverride?: GatewayCredentialMode;
  localTokenPrecedence?: GatewayCredentialPrecedence;
  localPasswordPrecedence?: GatewayCredentialPrecedence;
  remoteTokenPrecedence?: GatewayRemoteCredentialPrecedence;
  remotePasswordPrecedence?: GatewayRemoteCredentialPrecedence;
  remoteTokenFallback?: GatewayRemoteCredentialFallback;
  remotePasswordFallback?: GatewayRemoteCredentialFallback;
};

function resolveGatewayCallTimeout(timeoutValue: unknown): {
  timeoutMs: number;
  safeTimerTimeoutMs: number;
} {
  const timeoutMs =
    typeof timeoutValue === "number" && Number.isFinite(timeoutValue) ? timeoutValue : 10_000;
  const safeTimerTimeoutMs = Math.max(1, Math.min(Math.floor(timeoutMs), 2_147_483_647));
  return { timeoutMs, safeTimerTimeoutMs };
}

function resolveGatewayCallContext(opts: CallGatewayBaseOptions): ResolvedGatewayCallContext {
  const config = opts.config ?? loadGatewayConfig();
  const configPath = opts.configPath ?? resolveGatewayConfigPath(process.env);
  const isRemoteMode = config.gateway?.mode === "remote";
  const remote = isRemoteMode
    ? (config.gateway?.remote as GatewayRemoteSettings | undefined)
    : undefined;
  const cliUrlOverride = trimToUndefined(opts.url);
  const envUrlOverride = cliUrlOverride
    ? undefined
    : trimToUndefined(process.env.CRAWCLAW_GATEWAY_URL);
  const urlOverride = cliUrlOverride ?? envUrlOverride;
  const urlOverrideSource = cliUrlOverride ? "cli" : envUrlOverride ? "env" : undefined;
  const remoteUrl = trimToUndefined(remote?.url);
  const explicitAuth = resolveExplicitGatewayAuth({ token: opts.token, password: opts.password });
  return {
    config,
    configPath,
    isRemoteMode,
    remote,
    urlOverride,
    urlOverrideSource,
    remoteUrl,
    explicitAuth,
  };
}

function ensureRemoteModeUrlConfigured(context: ResolvedGatewayCallContext): void {
  if (!context.isRemoteMode || context.urlOverride || context.remoteUrl) {
    return;
  }
  throw new Error(
    [
      "gateway remote mode misconfigured: gateway.remote.url missing",
      `Config: ${context.configPath}`,
      "Fix: set gateway.remote.url, or set gateway.mode=local.",
    ].join("\n"),
  );
}

async function resolveGatewaySecretInputString(params: {
  config: CrawClawConfig;
  value: unknown;
  path: string;
  env: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  const value = await resolveSecretInputString({
    config: params.config,
    value: params.value,
    env: params.env,
    normalize: trimToUndefined,
    onResolveRefError: () => {
      throw new GatewaySecretRefUnavailableError(params.path);
    },
  });
  if (!value) {
    throw new Error(`${params.path} resolved to an empty or non-string value.`);
  }
  return value;
}

async function resolveGatewayCredentials(context: ResolvedGatewayCallContext): Promise<{
  token?: string;
  password?: string;
}> {
  return resolveGatewayCredentialsWithEnv(context, process.env);
}

async function resolveGatewayCredentialsWithEnv(
  context: ResolvedGatewayCallContext,
  env: NodeJS.ProcessEnv,
): Promise<{
  token?: string;
  password?: string;
}> {
  if (context.explicitAuth.token || context.explicitAuth.password) {
    return {
      token: context.explicitAuth.token,
      password: context.explicitAuth.password,
    };
  }
  return resolveGatewayCredentialsFromConfigWithSecretInputs({ context, env });
}

type SupportedGatewaySecretInputPath =
  | "gateway.auth.token"
  | "gateway.auth.password"
  | "gateway.remote.token"
  | "gateway.remote.password";

const ALL_GATEWAY_SECRET_INPUT_PATHS: SupportedGatewaySecretInputPath[] = [
  "gateway.auth.token",
  "gateway.auth.password",
  "gateway.remote.token",
  "gateway.remote.password",
];

function isSupportedGatewaySecretInputPath(path: string): path is SupportedGatewaySecretInputPath {
  return (
    path === "gateway.auth.token" ||
    path === "gateway.auth.password" ||
    path === "gateway.remote.token" ||
    path === "gateway.remote.password"
  );
}

function readGatewaySecretInputValue(
  config: CrawClawConfig,
  path: SupportedGatewaySecretInputPath,
): unknown {
  if (path === "gateway.auth.token") {
    return config.gateway?.auth?.token;
  }
  if (path === "gateway.auth.password") {
    return config.gateway?.auth?.password;
  }
  if (path === "gateway.remote.token") {
    return config.gateway?.remote?.token;
  }
  return config.gateway?.remote?.password;
}

function hasConfiguredGatewaySecretRef(
  config: CrawClawConfig,
  path: SupportedGatewaySecretInputPath,
): boolean {
  return Boolean(
    resolveSecretInputRef({
      value: readGatewaySecretInputValue(config, path),
      defaults: config.secrets?.defaults,
    }).ref,
  );
}

function resolveGatewayCredentialsFromConfigOptions(params: {
  context: ResolvedGatewayCallContext;
  env: NodeJS.ProcessEnv;
  cfg: CrawClawConfig;
}) {
  const { context, env, cfg } = params;
  return {
    cfg,
    env,
    explicitAuth: context.explicitAuth,
    urlOverride: context.urlOverride,
    urlOverrideSource: context.urlOverrideSource,
    modeOverride: context.modeOverride,
    localTokenPrecedence: context.localTokenPrecedence,
    localPasswordPrecedence: context.localPasswordPrecedence,
    remoteTokenPrecedence: context.remoteTokenPrecedence,
    remotePasswordPrecedence: context.remotePasswordPrecedence ?? "env-first", // pragma: allowlist secret
    remoteTokenFallback: context.remoteTokenFallback,
    remotePasswordFallback: context.remotePasswordFallback,
  } as const;
}

function isTokenGatewaySecretInputPath(path: SupportedGatewaySecretInputPath): boolean {
  return path === "gateway.auth.token" || path === "gateway.remote.token";
}

function localAuthModeAllowsGatewaySecretInputPath(params: {
  authMode: string | undefined;
  path: SupportedGatewaySecretInputPath;
}): boolean {
  const { authMode, path } = params;
  if (authMode === "none" || authMode === "trusted-proxy") {
    return false;
  }
  if (authMode === "token") {
    return isTokenGatewaySecretInputPath(path);
  }
  if (authMode === "password") {
    return !isTokenGatewaySecretInputPath(path);
  }
  return true;
}

function gatewaySecretInputPathCanWin(params: {
  context: ResolvedGatewayCallContext;
  env: NodeJS.ProcessEnv;
  config: CrawClawConfig;
  path: SupportedGatewaySecretInputPath;
}): boolean {
  if (!hasConfiguredGatewaySecretRef(params.config, params.path)) {
    return false;
  }
  const mode: GatewayCredentialMode =
    params.context.modeOverride ?? (params.config.gateway?.mode === "remote" ? "remote" : "local");
  if (
    mode === "local" &&
    !localAuthModeAllowsGatewaySecretInputPath({
      authMode: params.config.gateway?.auth?.mode,
      path: params.path,
    })
  ) {
    return false;
  }
  const sentinel = `__CRAWCLAW_GATEWAY_SECRET_REF_PROBE_${params.path.replaceAll(".", "_")}__`;
  const probeConfig = structuredClone(params.config);
  for (const candidatePath of ALL_GATEWAY_SECRET_INPUT_PATHS) {
    if (!hasConfiguredGatewaySecretRef(probeConfig, candidatePath)) {
      continue;
    }
    assignResolvedGatewaySecretInput({
      config: probeConfig,
      path: candidatePath,
      value: undefined,
    });
  }
  assignResolvedGatewaySecretInput({
    config: probeConfig,
    path: params.path,
    value: sentinel,
  });
  try {
    const resolved = resolveGatewayCredentialsFromConfig(
      resolveGatewayCredentialsFromConfigOptions({
        context: params.context,
        env: params.env,
        cfg: probeConfig,
      }),
    );
    const tokenCanWin = resolved.token === sentinel && !resolved.password;
    const passwordCanWin = resolved.password === sentinel && !resolved.token;
    return tokenCanWin || passwordCanWin;
  } catch {
    return false;
  }
}

async function resolveConfiguredGatewaySecretInput(params: {
  config: CrawClawConfig;
  path: SupportedGatewaySecretInputPath;
  env: NodeJS.ProcessEnv;
}): Promise<string | undefined> {
  const { config, path, env } = params;
  if (path === "gateway.auth.token") {
    return resolveGatewaySecretInputString({
      config,
      value: config.gateway?.auth?.token,
      path,
      env,
    });
  }
  if (path === "gateway.auth.password") {
    return resolveGatewaySecretInputString({
      config,
      value: config.gateway?.auth?.password,
      path,
      env,
    });
  }
  if (path === "gateway.remote.token") {
    return resolveGatewaySecretInputString({
      config,
      value: config.gateway?.remote?.token,
      path,
      env,
    });
  }
  return resolveGatewaySecretInputString({
    config,
    value: config.gateway?.remote?.password,
    path,
    env,
  });
}

function assignResolvedGatewaySecretInput(params: {
  config: CrawClawConfig;
  path: SupportedGatewaySecretInputPath;
  value: string | undefined;
}): void {
  const { config, path, value } = params;
  if (path === "gateway.auth.token") {
    if (config.gateway?.auth) {
      config.gateway.auth.token = value;
    }
    return;
  }
  if (path === "gateway.auth.password") {
    if (config.gateway?.auth) {
      config.gateway.auth.password = value;
    }
    return;
  }
  if (path === "gateway.remote.token") {
    if (config.gateway?.remote) {
      config.gateway.remote.token = value;
    }
    return;
  }
  if (config.gateway?.remote) {
    config.gateway.remote.password = value;
  }
}

async function resolvePreferredGatewaySecretInputs(params: {
  context: ResolvedGatewayCallContext;
  env: NodeJS.ProcessEnv;
  config: CrawClawConfig;
}): Promise<CrawClawConfig> {
  let nextConfig = params.config;
  for (const path of ALL_GATEWAY_SECRET_INPUT_PATHS) {
    if (
      !gatewaySecretInputPathCanWin({
        context: params.context,
        env: params.env,
        config: nextConfig,
        path,
      })
    ) {
      continue;
    }
    if (nextConfig === params.config) {
      nextConfig = structuredClone(params.config);
    }
    try {
      const resolvedValue = await resolveConfiguredGatewaySecretInput({
        config: nextConfig,
        path,
        env: params.env,
      });
      assignResolvedGatewaySecretInput({
        config: nextConfig,
        path,
        value: resolvedValue,
      });
    } catch {
      // Keep scanning candidate paths so unresolved higher-priority refs do not
      // prevent valid fallback refs from being considered.
      continue;
    }
  }
  return nextConfig;
}

async function resolveGatewayCredentialsFromConfigWithSecretInputs(params: {
  context: ResolvedGatewayCallContext;
  env: NodeJS.ProcessEnv;
}): Promise<{ token?: string; password?: string }> {
  let resolvedConfig = await resolvePreferredGatewaySecretInputs({
    context: params.context,
    env: params.env,
    config: params.context.config,
  });
  const resolvedPaths = new Set<SupportedGatewaySecretInputPath>();
  for (;;) {
    try {
      return resolveGatewayCredentialsFromConfig(
        resolveGatewayCredentialsFromConfigOptions({
          context: params.context,
          env: params.env,
          cfg: resolvedConfig,
        }),
      );
    } catch (error) {
      if (!(error instanceof GatewaySecretRefUnavailableError)) {
        throw error;
      }
      const path = error.path;
      if (!isSupportedGatewaySecretInputPath(path) || resolvedPaths.has(path)) {
        throw error;
      }
      if (resolvedConfig === params.context.config) {
        resolvedConfig = structuredClone(params.context.config);
      }
      const resolvedValue = await resolveConfiguredGatewaySecretInput({
        config: resolvedConfig,
        path,
        env: params.env,
      });
      assignResolvedGatewaySecretInput({
        config: resolvedConfig,
        path,
        value: resolvedValue,
      });
      resolvedPaths.add(path);
    }
  }
}

export async function resolveGatewayCredentialsWithSecretInputs(params: {
  config: CrawClawConfig;
  explicitAuth?: ExplicitGatewayAuth;
  urlOverride?: string;
  urlOverrideSource?: "cli" | "env";
  env?: NodeJS.ProcessEnv;
  modeOverride?: GatewayCredentialMode;
  localTokenPrecedence?: GatewayCredentialPrecedence;
  localPasswordPrecedence?: GatewayCredentialPrecedence;
  remoteTokenPrecedence?: GatewayRemoteCredentialPrecedence;
  remotePasswordPrecedence?: GatewayRemoteCredentialPrecedence;
  remoteTokenFallback?: GatewayRemoteCredentialFallback;
  remotePasswordFallback?: GatewayRemoteCredentialFallback;
}): Promise<{ token?: string; password?: string }> {
  const modeOverride = params.modeOverride;
  const isRemoteMode = modeOverride
    ? modeOverride === "remote"
    : params.config.gateway?.mode === "remote";
  const remoteFromConfig =
    params.config.gateway?.mode === "remote"
      ? (params.config.gateway?.remote as GatewayRemoteSettings | undefined)
      : undefined;
  const remoteFromOverride =
    modeOverride === "remote"
      ? (params.config.gateway?.remote as GatewayRemoteSettings | undefined)
      : undefined;
  const context: ResolvedGatewayCallContext = {
    config: params.config,
    configPath: resolveGatewayConfigPath(process.env),
    isRemoteMode,
    remote: remoteFromOverride ?? remoteFromConfig,
    urlOverride: trimToUndefined(params.urlOverride),
    urlOverrideSource: params.urlOverrideSource,
    remoteUrl: isRemoteMode
      ? trimToUndefined((params.config.gateway?.remote as GatewayRemoteSettings | undefined)?.url)
      : undefined,
    explicitAuth: resolveExplicitGatewayAuth(params.explicitAuth),
    modeOverride,
    localTokenPrecedence: params.localTokenPrecedence,
    localPasswordPrecedence: params.localPasswordPrecedence,
    remoteTokenPrecedence: params.remoteTokenPrecedence,
    remotePasswordPrecedence: params.remotePasswordPrecedence,
    remoteTokenFallback: params.remoteTokenFallback,
    remotePasswordFallback: params.remotePasswordFallback,
  };
  return resolveGatewayCredentialsWithEnv(context, params.env ?? process.env);
}

async function resolveGatewayTlsFingerprint(params: {
  opts: CallGatewayBaseOptions;
  context: ResolvedGatewayCallContext;
  url: string;
}): Promise<string | undefined> {
  const { opts, context, url } = params;
  const useLocalTls =
    context.config.gateway?.tls?.enabled === true &&
    !context.urlOverrideSource &&
    !context.remoteUrl &&
    url.startsWith("wss://");
  const tlsRuntime = useLocalTls
    ? await gatewayCallDeps.loadGatewayTlsRuntime(context.config.gateway?.tls)
    : undefined;
  const overrideTlsFingerprint = trimToUndefined(opts.tlsFingerprint);
  const remoteTlsFingerprint =
    // Env overrides may still inherit configured remote TLS pinning for private cert deployments.
    // CLI overrides remain explicit-only and intentionally skip config remote TLS to avoid
    // accidentally pinning against caller-supplied target URLs.
    context.isRemoteMode && context.urlOverrideSource !== "cli"
      ? trimToUndefined(context.remote?.tlsFingerprint)
      : undefined;
  return (
    overrideTlsFingerprint ||
    remoteTlsFingerprint ||
    (tlsRuntime?.enabled ? tlsRuntime.fingerprintSha256 : undefined)
  );
}

function formatGatewayTimeoutError(
  timeoutMs: number,
  connectionDetails: GatewayConnectionDetails,
): string {
  return `gateway timeout after ${timeoutMs}ms\n${connectionDetails.message}`;
}

function ensureGatewaySupportsRequiredMethods(params: {
  requiredMethods: string[] | undefined;
  methods: string[] | undefined;
  attemptedMethod: string;
}): void {
  const requiredMethods = Array.isArray(params.requiredMethods)
    ? params.requiredMethods.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    : [];
  if (requiredMethods.length === 0) {
    return;
  }
  const supportedMethods = new Set(
    (Array.isArray(params.methods) ? params.methods : [])
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );
  for (const method of requiredMethods) {
    if (supportedMethods.has(method)) {
      continue;
    }
    throw new Error(
      [
        `active gateway does not support required method "${method}" for "${params.attemptedMethod}".`,
        "Update the gateway or run without SecretRefs.",
      ].join(" "),
    );
  }
}

type GatewayRpcEnvelope = {
  ok?: unknown;
  result?: unknown;
  error?: unknown;
};

function gatewayHttpRpcUrlFromGatewayUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  }
  parsed.pathname = "/api/gateway/rpc";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

function gatewayHttpRpcHeaders(token?: string, password?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  const credential = token ?? password;
  if (credential) {
    headers[GATEWAY_TOKEN_HEADER] = credential;
  }
  return headers;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function executeGatewayHttpRpcRequest<T>(params: {
  opts: CallGatewayBaseOptions;
  url: string;
  token?: string;
  password?: string;
  tlsFingerprint?: string;
  timeoutMs: number;
  safeTimerTimeoutMs: number;
  connectionDetails: GatewayConnectionDetails;
}): Promise<T> {
  const rpcUrl = gatewayHttpRpcUrlFromGatewayUrl(params.url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.safeTimerTimeoutMs);
  const request = async <TResult>(method: string, requestParams: unknown): Promise<TResult> => {
    const response = await gatewayCallDeps.fetch(
      rpcUrl,
      {
        method: "POST",
        headers: gatewayHttpRpcHeaders(params.token, params.password),
        body: JSON.stringify({
          id: randomUUID(),
          method,
          params: requestParams ?? {},
        }),
        signal: controller.signal,
      },
      { tlsFingerprint: params.tlsFingerprint },
    );
    if (!response.ok) {
      throw new Error(
        [
          `gateway HTTP RPC failed (${response.status} ${response.statusText})`,
          params.connectionDetails.message,
        ].join("\n"),
      );
    }
    const envelope = (await response.json()) as GatewayRpcEnvelope;
    if (envelope.ok !== true) {
      const message =
        typeof envelope.error === "string" && envelope.error.trim().length > 0
          ? envelope.error
          : "gateway request failed";
      throw new Error(message);
    }
    return envelope.result as TResult;
  };

  try {
    if (Array.isArray(params.opts.requiredMethods) && params.opts.requiredMethods.length > 0) {
      const status = await request<{ gatewayMethods?: string[] }>("system.status", {});
      ensureGatewaySupportsRequiredMethods({
        requiredMethods: params.opts.requiredMethods,
        methods: status.gatewayMethods,
        attemptedMethod: params.opts.method,
      });
    }
    return await request<T>(params.opts.method, params.opts.params ?? {});
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(formatGatewayTimeoutError(params.timeoutMs, params.connectionDetails), {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callGatewayWithScopes<T = Record<string, unknown>>(
  opts: CallGatewayBaseOptions,
  _scopes?: OperatorScope[],
): Promise<T> {
  const { timeoutMs, safeTimerTimeoutMs } = resolveGatewayCallTimeout(opts.timeoutMs);
  const context = resolveGatewayCallContext(opts);
  const resolvedCredentials = await resolveGatewayCredentials(context);
  ensureExplicitGatewayAuth({
    urlOverride: context.urlOverride,
    urlOverrideSource: context.urlOverrideSource,
    explicitAuth: context.explicitAuth,
    resolvedAuth: resolvedCredentials,
    errorHint: "Fix: pass --token or --password (or gatewayToken in tools).",
    configPath: context.configPath,
  });
  ensureRemoteModeUrlConfigured(context);
  const connectionDetails = buildGatewayConnectionDetails({
    config: context.config,
    url: context.urlOverride,
    urlSource: context.urlOverrideSource,
    ...(opts.configPath ? { configPath: opts.configPath } : {}),
  });
  const url = connectionDetails.url;
  const tlsFingerprint = await resolveGatewayTlsFingerprint({ opts, context, url });
  const { token, password } = resolvedCredentials;
  return await executeGatewayHttpRpcRequest<T>({
    opts,
    url,
    token,
    password,
    tlsFingerprint,
    timeoutMs,
    safeTimerTimeoutMs,
    connectionDetails,
  });
}

export async function callGatewayScoped<T = Record<string, unknown>>(
  opts: CallGatewayScopedOptions,
): Promise<T> {
  return await callGatewayWithScopes(opts, opts.scopes);
}

export async function callGatewayCli<T = Record<string, unknown>>(
  opts: CallGatewayCliOptions,
): Promise<T> {
  return await callGatewayWithScopes(opts, opts.scopes);
}

export async function callGateway<T = Record<string, unknown>>(
  opts: CallGatewayOptions,
): Promise<T> {
  return await callGatewayWithScopes(opts, opts.scopes);
}

export function randomIdempotencyKey() {
  return randomUUID();
}
