import { createCliTranslator, getActiveCliLocale } from "../../../cli/i18n/text.js";
import type { CrawClawConfig } from "../../../config/config.js";
import { isValidEnvSecretRefId } from "../../../config/types.secrets.js";
import type { RuntimeEnv } from "../../../runtime.js";
import { resolveDefaultSecretProviderAlias } from "../../../secrets/ref-contract.js";
import { normalizeGatewayTokenInput, randomToken } from "../../onboard-helpers.js";
import type { OnboardOptions } from "../../onboard-types.js";

const VALID_GATEWAY_BINDS = new Set(["loopback", "lan", "auto", "custom", "tailnet"]);
const VALID_TAILSCALE_MODES = new Set(["off", "serve", "funnel"]);

export function applyNonInteractiveGatewayConfig(params: {
  nextConfig: CrawClawConfig;
  opts: OnboardOptions;
  runtime: RuntimeEnv;
  defaultPort: number;
}): {
  nextConfig: CrawClawConfig;
  port: number;
  bind: string;
  authMode: string;
  tailscaleMode: string;
  tailscaleResetOnExit: boolean;
  gatewayToken?: string;
} | null {
  const { opts, runtime } = params;
  const t = createCliTranslator(getActiveCliLocale());

  const hasGatewayPort = opts.gatewayPort !== undefined;
  if (hasGatewayPort && (!Number.isFinite(opts.gatewayPort) || (opts.gatewayPort ?? 0) <= 0)) {
    runtime.error(t("wizard.gateway.error.invalidPort"));
    runtime.exit(1);
    return null;
  }

  const port = hasGatewayPort ? (opts.gatewayPort as number) : params.defaultPort;
  let bind = opts.gatewayBind ?? "loopback";
  if (!VALID_GATEWAY_BINDS.has(bind)) {
    runtime.error(t("wizard.gateway.error.invalidBind"));
    runtime.exit(1);
    return null;
  }
  const authModeRaw = opts.gatewayAuth ?? "token";
  if (authModeRaw !== "token" && authModeRaw !== "password") {
    runtime.error(t("wizard.gateway.error.invalidAuth"));
    runtime.exit(1);
    return null;
  }
  let authMode = authModeRaw;
  const tailscaleMode = opts.tailscale ?? "off";
  if (!VALID_TAILSCALE_MODES.has(tailscaleMode)) {
    runtime.error(t("wizard.gateway.error.invalidTailscale"));
    runtime.exit(1);
    return null;
  }
  const tailscaleResetOnExit = Boolean(opts.tailscaleResetOnExit);

  // Tighten config to safe combos:
  // - If Tailscale is on, force loopback bind (the tunnel handles external access).
  // - If using Tailscale Funnel, require password auth.
  if (tailscaleMode !== "off" && bind !== "loopback") {
    bind = "loopback";
  }
  if (tailscaleMode === "funnel" && authMode !== "password") {
    authMode = "password";
  }

  let nextConfig = params.nextConfig;
  const explicitGatewayToken = normalizeGatewayTokenInput(opts.gatewayToken);
  const envGatewayToken = normalizeGatewayTokenInput(process.env.CRAWCLAW_GATEWAY_TOKEN);
  let gatewayToken = explicitGatewayToken || envGatewayToken || undefined;
  const gatewayTokenRefEnv = (opts.gatewayTokenRefEnv ?? "").trim();

  if (authMode === "token") {
    if (gatewayTokenRefEnv) {
      if (!isValidEnvSecretRefId(gatewayTokenRefEnv)) {
        runtime.error(t("wizard.gateway.error.invalidTokenRefEnv"));
        runtime.exit(1);
        return null;
      }
      if (explicitGatewayToken) {
        runtime.error(t("wizard.gateway.error.tokenOrRef"));
        runtime.exit(1);
        return null;
      }
      const resolvedFromEnv = process.env[gatewayTokenRefEnv]?.trim();
      if (!resolvedFromEnv) {
        runtime.error(t("wizard.gateway.error.envMissing", { env: gatewayTokenRefEnv }));
        runtime.exit(1);
        return null;
      }
      gatewayToken = resolvedFromEnv;
      nextConfig = {
        ...nextConfig,
        gateway: {
          ...nextConfig.gateway,
          auth: {
            ...nextConfig.gateway?.auth,
            mode: "token",
            token: {
              source: "env",
              provider: resolveDefaultSecretProviderAlias(nextConfig, "env", {
                preferFirstProviderForSource: true,
              }),
              id: gatewayTokenRefEnv,
            },
          },
        },
      };
    } else {
      if (!gatewayToken) {
        gatewayToken = randomToken();
      }
      nextConfig = {
        ...nextConfig,
        gateway: {
          ...nextConfig.gateway,
          auth: {
            ...nextConfig.gateway?.auth,
            mode: "token",
            token: gatewayToken,
          },
        },
      };
    }
  }

  if (authMode === "password") {
    const password = opts.gatewayPassword?.trim();
    if (!password) {
      runtime.error(t("wizard.gateway.error.missingPassword"));
      runtime.exit(1);
      return null;
    }
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        auth: {
          ...nextConfig.gateway?.auth,
          mode: "password",
          password,
        },
      },
    };
  }

  nextConfig = {
    ...nextConfig,
    gateway: {
      ...nextConfig.gateway,
      port,
      bind,
      tailscale: {
        ...nextConfig.gateway?.tailscale,
        mode: tailscaleMode,
        resetOnExit: tailscaleResetOnExit,
      },
    },
  };

  return {
    nextConfig,
    port,
    bind,
    authMode,
    tailscaleMode,
    tailscaleResetOnExit,
    gatewayToken,
  };
}
