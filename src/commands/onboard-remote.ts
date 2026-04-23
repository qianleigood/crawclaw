import { createCliTranslator, getActiveCliLocale } from "../cli/i18n/text.js";
import type { CrawClawConfig } from "../config/config.js";
import type { SecretInput } from "../config/types.secrets.js";
import { isSecureWebSocketUrl } from "../gateway/net.js";
import { discoverGatewayBeacons, type GatewayBonjourBeacon } from "../infra/bonjour-discovery.js";
import {
  buildGatewayDiscoveryLabel,
  buildGatewayDiscoveryTarget,
} from "../infra/gateway-discovery-targets.js";
import { resolveWideAreaDiscoveryDomain } from "../infra/widearea-dns.js";
import { resolveSecretInputModeForEnvSelection } from "../plugins/provider-auth-mode.js";
import { promptSecretRefForSetup } from "../plugins/provider-auth-ref.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { detectBinary } from "./onboard-helpers.js";
import type { SecretInputMode } from "./onboard-types.js";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

function t(key: string, params?: Record<string, string | number>): string {
  return createCliTranslator(getActiveCliLocale())(key, params);
}

function buildLabel(beacon: GatewayBonjourBeacon): string {
  return buildGatewayDiscoveryLabel(beacon);
}

function ensureWsUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_GATEWAY_URL;
  }
  return trimmed;
}

function validateGatewayWebSocketUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("ws://") && !trimmed.startsWith("wss://")) {
    return t("wizard.remote.urlMustStartWs");
  }
  if (
    !isSecureWebSocketUrl(trimmed, {
      allowPrivateWs: process.env.CRAWCLAW_ALLOW_INSECURE_PRIVATE_WS === "1",
    })
  ) {
    return t("wizard.remote.urlSecurity");
  }
  return undefined;
}

export async function promptRemoteGatewayConfig(
  cfg: CrawClawConfig,
  prompter: WizardPrompter,
  options?: { secretInputMode?: SecretInputMode },
): Promise<CrawClawConfig> {
  let selectedBeacon: GatewayBonjourBeacon | null = null;
  let suggestedUrl = cfg.gateway?.remote?.url ?? DEFAULT_GATEWAY_URL;
  let discoveryTlsFingerprint: string | undefined;
  let trustedDiscoveryUrl: string | undefined;

  const hasBonjourTool = (await detectBinary("dns-sd")) || (await detectBinary("avahi-browse"));
  const wantsDiscover = hasBonjourTool
    ? await prompter.confirm({
        message: t("ui.text.discoverGatewayLan"),
        initialValue: true,
      })
    : false;

  if (!hasBonjourTool) {
    await prompter.note(t("wizard.remote.discoveryMissing"), t("wizard.remote.discoveryTitle"));
  }

  if (wantsDiscover) {
    const wideAreaDomain = resolveWideAreaDiscoveryDomain({
      configDomain: cfg.discovery?.wideArea?.domain,
    });
    const spin = prompter.progress(t("wizard.remote.searching"));
    const beacons = await discoverGatewayBeacons({ timeoutMs: 2000, wideAreaDomain });
    spin.stop(
      beacons.length > 0
        ? t("wizard.remote.foundGateways", { count: beacons.length })
        : t("wizard.remote.noGateways"),
    );

    if (beacons.length > 0) {
      const selection = await prompter.select({
        message: t("ui.text.selectGateway"),
        options: [
          ...beacons.map((beacon, index) => ({
            value: String(index),
            label: buildLabel(beacon),
          })),
          { value: "manual", label: t("ui.text.enterUrlManually") },
        ],
      });
      if (selection !== "manual") {
        const idx = Number.parseInt(selection, 10);
        selectedBeacon = Number.isFinite(idx) ? (beacons[idx] ?? null) : null;
      }
    }
  }

  if (selectedBeacon) {
    const target = buildGatewayDiscoveryTarget(selectedBeacon);
    if (target.endpoint) {
      const { host, port } = target.endpoint;
      const mode = await prompter.select({
        message: t("ui.text.connectionMethod"),
        options: [
          {
            value: "direct",
            label: t("wizard.remote.directGateway", { host, port }),
          },
          { value: "ssh", label: t("wizard.remote.sshTunnelLoopback") },
        ],
      });
      if (mode === "direct") {
        suggestedUrl = `wss://${host}:${port}`;
        const fingerprint = target.endpoint.gatewayTlsFingerprintSha256;
        const trusted = await prompter.confirm({
          message: t("wizard.remote.trustGateway", {
            host,
            port,
            fingerprint: fingerprint ?? t("wizard.remote.fingerprintMissing"),
          }),
          initialValue: false,
        });
        if (trusted) {
          discoveryTlsFingerprint = fingerprint;
          trustedDiscoveryUrl = suggestedUrl;
          await prompter.note(
            t("wizard.remote.directNote", {
              url: suggestedUrl,
              fingerprintLine: fingerprint ? t("wizard.remote.tlsPinLine", { fingerprint }) : "",
            }),
            t("wizard.remote.directTitle"),
          );
        } else {
          // Clear the discovered endpoint so the manual prompt falls back to a safe default.
          suggestedUrl = DEFAULT_GATEWAY_URL;
        }
      } else {
        suggestedUrl = DEFAULT_GATEWAY_URL;
        await prompter.note(
          t("wizard.remote.sshNote", {
            host,
            portArg: target.sshPort ? ` -p ${target.sshPort}` : "",
          }),
          t("wizard.remote.sshTitle"),
        );
      }
    }
  }

  const urlInput = await prompter.text({
    message: t("ui.text.gatewayWebsocketUrl"),
    initialValue: suggestedUrl,
    validate: (value) => validateGatewayWebSocketUrl(value),
  });
  const url = ensureWsUrl(urlInput);
  const pinnedDiscoveryFingerprint =
    discoveryTlsFingerprint && url === trustedDiscoveryUrl ? discoveryTlsFingerprint : undefined;

  const authChoice = await prompter.select({
    message: t("wizard.gateway.auth.message"),
    options: [
      { value: "token", label: t("ui.text.tokenRecommended") },
      { value: "password", label: t("ui.text.password") },
      { value: "off", label: t("ui.text.noAuth") },
    ],
  });

  let token: SecretInput | undefined = cfg.gateway?.remote?.token;
  let password: SecretInput | undefined = cfg.gateway?.remote?.password;
  if (authChoice === "token") {
    const selectedMode = await resolveSecretInputModeForEnvSelection({
      prompter,
      explicitMode: options?.secretInputMode,
      copy: {
        modeMessage: t("wizard.remote.tokenModeMessage"),
        plaintextLabel: t("wizard.remote.tokenPlaintextLabel"),
        plaintextHint: t("wizard.remote.tokenPlaintextHint"),
      },
    });
    if (selectedMode === "ref") {
      const resolved = await promptSecretRefForSetup({
        provider: "gateway-remote-token",
        config: cfg,
        prompter,
        preferredEnvVar: "CRAWCLAW_GATEWAY_TOKEN",
        copy: {
          sourceMessage: t("wizard.remote.tokenSourceMessage"),
          envVarPlaceholder: "CRAWCLAW_GATEWAY_TOKEN",
        },
      });
      token = resolved.ref;
    } else {
      token = (
        await prompter.text({
          message: t("ui.text.gatewayToken"),
          initialValue: typeof token === "string" ? token : undefined,
          validate: (value) => (value?.trim() ? undefined : t("wizard.required")),
        })
      ).trim();
    }
    password = undefined;
  } else if (authChoice === "password") {
    const selectedMode = await resolveSecretInputModeForEnvSelection({
      prompter,
      explicitMode: options?.secretInputMode,
      copy: {
        modeMessage: t("wizard.remote.passwordModeMessage"),
        plaintextLabel: t("wizard.remote.passwordPlaintextLabel"),
        plaintextHint: t("wizard.remote.passwordPlaintextHint"),
      },
    });
    if (selectedMode === "ref") {
      const resolved = await promptSecretRefForSetup({
        provider: "gateway-remote-password",
        config: cfg,
        prompter,
        preferredEnvVar: "CRAWCLAW_GATEWAY_PASSWORD",
        copy: {
          sourceMessage: t("wizard.remote.passwordSourceMessage"),
          envVarPlaceholder: "CRAWCLAW_GATEWAY_PASSWORD",
        },
      });
      password = resolved.ref;
    } else {
      password = (
        await prompter.text({
          message: t("ui.text.gatewayPassword"),
          initialValue: typeof password === "string" ? password : undefined,
          validate: (value) => (value?.trim() ? undefined : t("wizard.required")),
        })
      ).trim();
    }
    token = undefined;
  } else {
    token = undefined;
    password = undefined;
  }

  return {
    ...cfg,
    gateway: {
      ...cfg.gateway,
      mode: "remote",
      remote: {
        url,
        ...(token !== undefined ? { token } : {}),
        ...(password !== undefined ? { password } : {}),
        ...(pinnedDiscoveryFingerprint ? { tlsFingerprint: pinnedDiscoveryFingerprint } : {}),
      },
    },
  };
}
