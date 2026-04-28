import { createCliTranslator, resolveCliLocaleFromRuntime } from "../cli/i18n/index.js";
import {
  normalizeGatewayTokenInput,
  randomToken,
  validateGatewayPasswordInput,
} from "../commands/onboard-helpers.js";
import type { GatewayAuthChoice, SecretInputMode } from "../commands/onboard-types.js";
import type { GatewayBindMode, GatewayTailscaleMode, CrawClawConfig } from "../config/config.js";
import { ensureBrowserClientsAllowedOriginsForNonLoopbackBind } from "../config/gateway-browser-client-origins.js";
import {
  normalizeSecretInputString,
  resolveSecretInputRef,
  type SecretInput,
} from "../config/types.secrets.js";
import {
  maybeAddTailnetOriginToBrowserClientsAllowedOrigins,
  TAILSCALE_DOCS_LINES,
  TAILSCALE_EXPOSURE_OPTIONS,
  TAILSCALE_MISSING_BIN_NOTE_LINES,
} from "../gateway/gateway-config-prompts.shared.js";
import { DEFAULT_DANGEROUS_NODE_COMMANDS } from "../gateway/node-command-policy.js";
import { findTailscaleBinary } from "../infra/tailscale.js";
import { resolveSecretInputModeForEnvSelection } from "../plugins/provider-auth-mode.js";
import { promptSecretRefForSetup } from "../plugins/provider-auth-ref.js";
import type { RuntimeEnv } from "../runtime.js";
import { validateIPv4AddressInput } from "../shared/net/ipv4.js";
import type { WizardPrompter } from "./prompts.js";
import { resolveSetupSecretInputString } from "./setup.secret-input.js";
import type {
  GatewayWizardSettings,
  QuickstartGatewayDefaults,
  WizardFlow,
} from "./setup.types.js";

type ConfigureGatewayOptions = {
  flow: WizardFlow;
  baseConfig: CrawClawConfig;
  nextConfig: CrawClawConfig;
  localPort: number;
  quickstartGateway: QuickstartGatewayDefaults;
  secretInputMode?: SecretInputMode;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
};

type ConfigureGatewayResult = {
  nextConfig: CrawClawConfig;
  settings: GatewayWizardSettings;
};

export async function configureGatewayForSetup(
  opts: ConfigureGatewayOptions,
): Promise<ConfigureGatewayResult> {
  const { flow, localPort, quickstartGateway, prompter } = opts;
  const t = createCliTranslator(resolveCliLocaleFromRuntime(process.argv));
  let { nextConfig } = opts;

  const port =
    flow === "quickstart"
      ? quickstartGateway.port
      : Number.parseInt(
          await prompter.text({
            message: t("wizard.gateway.port.message"),
            initialValue: String(localPort),
            validate: (value) =>
              Number.isFinite(Number(value)) ? undefined : t("wizard.gateway.port.invalid"),
          }),
          10,
        );

  let bind: GatewayWizardSettings["bind"] =
    flow === "quickstart"
      ? quickstartGateway.bind
      : await prompter.select<GatewayWizardSettings["bind"]>({
          message: t("wizard.gateway.bind.message"),
          options: [
            { value: "loopback", label: t("wizard.gateway.bind.loopback") },
            { value: "lan", label: t("wizard.gateway.bind.lan") },
            { value: "tailnet", label: t("wizard.gateway.bind.tailnet") },
            { value: "auto", label: t("wizard.gateway.bind.auto") },
            { value: "custom", label: t("wizard.gateway.bind.custom") },
          ],
        });

  let customBindHost = quickstartGateway.customBindHost;
  if (bind === "custom") {
    const needsPrompt = flow !== "quickstart" || !customBindHost;
    if (needsPrompt) {
      const input = await prompter.text({
        message: t("wizard.gateway.customIp.message"),
        placeholder: "192.168.1.100",
        initialValue: customBindHost ?? "",
        validate: validateIPv4AddressInput,
      });
      customBindHost = typeof input === "string" ? input.trim() : undefined;
    }
  }

  let authMode =
    flow === "quickstart"
      ? quickstartGateway.authMode
      : ((await prompter.select({
          message: t("wizard.gateway.auth.message"),
          options: [
            {
              value: "token",
              label: t("wizard.gateway.auth.token"),
              hint: t("wizard.gateway.auth.tokenHint"),
            },
            { value: "password", label: t("wizard.gateway.auth.password") },
          ],
          initialValue: "token",
        })) as GatewayAuthChoice);

  const tailscaleMode: GatewayWizardSettings["tailscaleMode"] =
    flow === "quickstart"
      ? quickstartGateway.tailscaleMode
      : await prompter.select<GatewayWizardSettings["tailscaleMode"]>({
          message: t("wizard.gateway.tailscale.message"),
          options: TAILSCALE_EXPOSURE_OPTIONS.map((option) => ({
            ...option,
            label: t(`wizard.gateway.tailscale.${option.value}.label`),
            hint: t(`wizard.gateway.tailscale.${option.value}.hint`),
          })),
        });

  // Detect Tailscale binary before proceeding with serve/funnel setup.
  // Persist the path so getTailnetHostname can reuse it for origin injection.
  let tailscaleBin: string | null = null;
  if (tailscaleMode !== "off") {
    tailscaleBin = await findTailscaleBinary();
    if (!tailscaleBin) {
      await prompter.note(
        TAILSCALE_MISSING_BIN_NOTE_LINES.join("\n"),
        t("wizard.gateway.tailscale.missingTitle"),
      );
    }
  }

  let tailscaleResetOnExit = flow === "quickstart" ? quickstartGateway.tailscaleResetOnExit : false;
  if (tailscaleMode !== "off" && flow !== "quickstart") {
    await prompter.note(TAILSCALE_DOCS_LINES.join("\n"), "Tailscale");
    tailscaleResetOnExit = await prompter.confirm({
      message: t("wizard.gateway.tailscale.resetOnExit"),
      initialValue: false,
    });
  }

  // Safety + constraints:
  // - Tailscale wants bind=loopback so we never expose a non-loopback server + tailscale serve/funnel at once.
  // - Funnel requires password auth.
  if (tailscaleMode !== "off" && bind !== "loopback") {
    await prompter.note(t("wizard.gateway.tailscale.requiresLoopback"), t("common.note"));
    bind = "loopback";
    customBindHost = undefined;
  }

  if (tailscaleMode === "funnel" && authMode !== "password") {
    await prompter.note(t("wizard.gateway.tailscale.funnelRequiresPassword"), t("common.note"));
    authMode = "password";
  }

  let gatewayToken: string | undefined;
  let gatewayTokenInput: SecretInput | undefined;
  if (authMode === "token") {
    const quickstartTokenString = normalizeSecretInputString(quickstartGateway.token);
    const quickstartTokenRef = resolveSecretInputRef({
      value: quickstartGateway.token,
      defaults: nextConfig.secrets?.defaults,
    }).ref;
    const tokenMode =
      flow === "quickstart" && opts.secretInputMode !== "ref" // pragma: allowlist secret
        ? quickstartTokenRef
          ? "ref"
          : "plaintext"
        : await resolveSecretInputModeForEnvSelection({
            prompter,
            explicitMode: opts.secretInputMode,
            copy: {
              modeMessage: t("wizard.gateway.token.modeMessage"),
              plaintextLabel: t("wizard.gateway.token.plaintextLabel"),
              plaintextHint: t("wizard.gateway.token.plaintextHint"),
              refLabel: t("wizard.gateway.token.refLabel"),
              refHint: t("wizard.gateway.token.refHint"),
            },
          });
    if (tokenMode === "ref") {
      if (flow === "quickstart" && quickstartTokenRef) {
        gatewayTokenInput = quickstartTokenRef;
        gatewayToken = await resolveSetupSecretInputString({
          config: nextConfig,
          value: quickstartTokenRef,
          path: "gateway.auth.token",
          env: process.env,
        });
      } else {
        const resolved = await promptSecretRefForSetup({
          provider: "gateway-auth-token",
          config: nextConfig,
          prompter,
          preferredEnvVar: "CRAWCLAW_GATEWAY_TOKEN",
          copy: {
            sourceMessage: t("wizard.gateway.token.sourceMessage"),
            envVarPlaceholder: "CRAWCLAW_GATEWAY_TOKEN",
          },
        });
        gatewayTokenInput = resolved.ref;
        gatewayToken = resolved.resolvedValue;
      }
    } else if (flow === "quickstart") {
      gatewayToken =
        (quickstartTokenString ?? normalizeGatewayTokenInput(process.env.CRAWCLAW_GATEWAY_TOKEN)) ||
        randomToken();
      gatewayTokenInput = gatewayToken;
    } else {
      const tokenInput = await prompter.text({
        message: t("wizard.gateway.token.inputMessage"),
        placeholder: t("wizard.gateway.token.inputPlaceholder"),
        initialValue:
          quickstartTokenString ??
          normalizeGatewayTokenInput(process.env.CRAWCLAW_GATEWAY_TOKEN) ??
          "",
      });
      gatewayToken = normalizeGatewayTokenInput(tokenInput) || randomToken();
      gatewayTokenInput = gatewayToken;
    }
  }

  if (authMode === "password") {
    let password: SecretInput | undefined =
      flow === "quickstart" && quickstartGateway.password ? quickstartGateway.password : undefined;
    if (!password) {
      const selectedMode = await resolveSecretInputModeForEnvSelection({
        prompter,
        explicitMode: opts.secretInputMode,
        copy: {
          modeMessage: t("wizard.gateway.password.modeMessage"),
          plaintextLabel: t("wizard.gateway.password.plaintextLabel"),
          plaintextHint: t("wizard.gateway.password.plaintextHint"),
        },
      });
      if (selectedMode === "ref") {
        const resolved = await promptSecretRefForSetup({
          provider: "gateway-auth-password",
          config: nextConfig,
          prompter,
          preferredEnvVar: "CRAWCLAW_GATEWAY_PASSWORD",
          copy: {
            sourceMessage: t("wizard.gateway.password.sourceMessage"),
            envVarPlaceholder: "CRAWCLAW_GATEWAY_PASSWORD",
          },
        });
        password = resolved.ref;
      } else {
        password = (
          (await prompter.text({
            message: t("wizard.gateway.password.inputMessage"),
            validate: validateGatewayPasswordInput,
          })) ?? ""
        ).trim();
      }
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
  } else if (authMode === "token") {
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        auth: {
          ...nextConfig.gateway?.auth,
          mode: "token",
          token: gatewayTokenInput,
        },
      },
    };
  }

  nextConfig = {
    ...nextConfig,
    gateway: {
      ...nextConfig.gateway,
      port,
      bind: bind as GatewayBindMode,
      ...(bind === "custom" && customBindHost ? { customBindHost } : {}),
      tailscale: {
        ...nextConfig.gateway?.tailscale,
        mode: tailscaleMode as GatewayTailscaleMode,
        resetOnExit: tailscaleResetOnExit,
      },
    },
  };

  if (
    flow === "quickstart" &&
    bind === "loopback" &&
    nextConfig.gateway?.browserClients?.allowInsecureAuth === undefined
  ) {
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        browserClients: {
          ...nextConfig.gateway?.browserClients,
          allowInsecureAuth: true,
        },
      },
    };
  }

  nextConfig = ensureBrowserClientsAllowedOriginsForNonLoopbackBind(nextConfig).config;
  nextConfig = await maybeAddTailnetOriginToBrowserClientsAllowedOrigins({
    config: nextConfig,
    tailscaleMode,
    tailscaleBin,
  });

  // If this is a new gateway setup (no existing gateway settings), start with a
  // denylist for high-risk node commands. Users can arm these temporarily via
  // /phone arm ... (phone-control plugin).
  if (
    !quickstartGateway.hasExisting &&
    nextConfig.gateway?.nodes?.denyCommands === undefined &&
    nextConfig.gateway?.nodes?.allowCommands === undefined &&
    nextConfig.gateway?.nodes?.browser === undefined
  ) {
    nextConfig = {
      ...nextConfig,
      gateway: {
        ...nextConfig.gateway,
        nodes: {
          ...nextConfig.gateway?.nodes,
          denyCommands: [...DEFAULT_DANGEROUS_NODE_COMMANDS],
        },
      },
    };
  }

  return {
    nextConfig,
    settings: {
      port,
      bind: bind as GatewayBindMode,
      customBindHost: bind === "custom" ? customBindHost : undefined,
      authMode,
      gatewayToken,
      tailscaleMode: tailscaleMode as GatewayTailscaleMode,
      tailscaleResetOnExit,
    },
  };
}
