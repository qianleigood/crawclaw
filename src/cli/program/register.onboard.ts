import type { Command } from "commander";
import { formatAuthChoiceChoicesForCli } from "../../commands/auth-choice-options.js";
import type { GatewayDaemonRuntime } from "../../commands/daemon-runtime.js";
import { CORE_ONBOARD_AUTH_FLAGS } from "../../commands/onboard-core-auth-flags.js";
import type {
  AuthChoice,
  GatewayAuthChoice,
  GatewayBind,
  NodeManagerChoice,
  OnboardOutputPreset,
  ResetScope,
  SecretInputMode,
  TailscaleMode,
} from "../../commands/onboard-types.js";
import { setupWizardCommand } from "../../commands/onboard.js";
import { resolveManifestProviderOnboardAuthFlags } from "../../plugins/provider-auth-choices.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { createCliTranslator } from "../i18n/index.js";
import { getProgramContext } from "./program-context.js";

function resolveInstallDaemonFlag(
  command: unknown,
  opts: { installDaemon?: boolean },
): boolean | undefined {
  if (!command || typeof command !== "object") {
    return undefined;
  }
  const getOptionValueSource =
    "getOptionValueSource" in command ? command.getOptionValueSource : undefined;
  if (typeof getOptionValueSource !== "function") {
    return undefined;
  }

  // Commander doesn't support option conflicts natively; keep original behavior.
  // If --skip-daemon is explicitly passed, it wins.
  if (getOptionValueSource.call(command, "skipDaemon") === "cli") {
    return false;
  }
  if (getOptionValueSource.call(command, "installDaemon") === "cli") {
    return Boolean(opts.installDaemon);
  }
  return undefined;
}

const AUTH_CHOICE_HELP = formatAuthChoiceChoicesForCli({
  includeSkip: true,
});

const ONBOARD_AUTH_FLAGS = [
  ...CORE_ONBOARD_AUTH_FLAGS,
  ...resolveManifestProviderOnboardAuthFlags(),
] as const;

function pickOnboardProviderAuthOptionValues(
  opts: Record<string, unknown>,
): Partial<Record<string, string | undefined>> {
  return Object.fromEntries(
    ONBOARD_AUTH_FLAGS.map((flag) => [flag.optionKey, opts[flag.optionKey] as string | undefined]),
  );
}

export function registerOnboardCommand(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const command = program
    .command("onboard")
    .description(t("command.onboard.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/onboard", "docs.crawclaw.ai/cli/onboard")}\n`,
    )
    .option("--workspace <dir>", t("command.onboard.option.workspace"))
    .option("--reset", t("command.onboard.option.reset"))
    .option("--reset-scope <scope>", t("command.onboard.option.resetScope"))
    .option("--non-interactive", t("command.onboard.option.nonInteractive"), false)
    .option("--accept-risk", t("command.onboard.option.acceptRisk"), false)
    .option("--flow <flow>", t("command.onboard.option.flow"))
    .option("--mode <mode>", t("command.onboard.option.mode"))
    .option(
      "--auth-choice <choice>",
      t("command.onboard.option.authChoice", { choices: AUTH_CHOICE_HELP }),
    )
    .option("--token-provider <id>", t("command.onboard.option.tokenProvider"))
    .option("--token <token>", t("command.onboard.option.token"))
    .option("--token-profile-id <id>", t("command.onboard.option.tokenProfileId"))
    .option("--token-expires-in <duration>", t("command.onboard.option.tokenExpiresIn"))
    .option("--secret-input-mode <mode>", t("command.onboard.option.secretInputMode"))
    .option(
      "--cloudflare-ai-gateway-account-id <id>",
      t("command.onboard.option.cloudflareAccountId"),
    )
    .option(
      "--cloudflare-ai-gateway-gateway-id <id>",
      t("command.onboard.option.cloudflareGatewayId"),
    );

  for (const providerFlag of ONBOARD_AUTH_FLAGS) {
    command.option(providerFlag.cliOption, providerFlag.description);
  }

  command
    .option("--custom-base-url <url>", t("command.onboard.option.customBaseUrl"))
    .option("--custom-api-key <key>", t("command.onboard.option.customApiKey"))
    .option("--custom-model-id <id>", t("command.onboard.option.customModelId"))
    .option("--custom-provider-id <id>", t("command.onboard.option.customProviderId"))
    .option("--custom-compatibility <mode>", t("command.onboard.option.customCompatibility"))
    .option("--gateway-port <port>", t("command.onboard.option.gatewayPort"))
    .option("--gateway-bind <mode>", t("command.onboard.option.gatewayBind"))
    .option("--gateway-auth <mode>", t("command.onboard.option.gatewayAuth"))
    .option("--gateway-token <token>", t("command.onboard.option.gatewayToken"))
    .option("--gateway-token-ref-env <name>", t("command.onboard.option.gatewayTokenRefEnv"))
    .option("--gateway-password <password>", t("command.onboard.option.gatewayPassword"))
    .option("--remote-url <url>", t("command.onboard.option.remoteUrl"))
    .option("--remote-token <token>", t("command.onboard.option.remoteToken"))
    .option("--tailscale <mode>", t("command.onboard.option.tailscale"))
    .option("--tailscale-reset-on-exit", t("command.onboard.option.tailscaleResetOnExit"))
    .option("--install-daemon", t("command.onboard.option.installDaemon"))
    .option("--no-install-daemon", t("command.onboard.option.noInstallDaemon"))
    .option("--skip-daemon", t("command.onboard.option.skipDaemon"))
    .option("--daemon-runtime <runtime>", t("command.onboard.option.daemonRuntime"))
    .option("--skip-channels", t("command.onboard.option.skipChannels"))
    .option("--skip-skills", t("command.onboard.option.skipSkills"))
    .option("--skip-search", t("command.onboard.option.skipSearch"))
    .option("--skip-health", t("command.onboard.option.skipHealth"))
    .option("--skip-ui", t("command.onboard.option.skipUi"))
    .option("--output-preset <preset>", t("command.onboard.option.outputPreset"))
    .option("--node-manager <name>", t("command.onboard.option.nodeManager"))
    .option("--json", t("command.onboard.option.json"), false);

  command.action(async (opts, commandRuntime) => {
    await runCommandWithRuntime(defaultRuntime, async () => {
      const installDaemon = resolveInstallDaemonFlag(commandRuntime, {
        installDaemon: Boolean(opts.installDaemon),
      });
      const gatewayPort =
        typeof opts.gatewayPort === "string" ? Number.parseInt(opts.gatewayPort, 10) : undefined;
      const providerAuthOptionValues = pickOnboardProviderAuthOptionValues(
        opts as Record<string, unknown>,
      );
      await setupWizardCommand(
        {
          workspace: opts.workspace as string | undefined,
          nonInteractive: Boolean(opts.nonInteractive),
          acceptRisk: Boolean(opts.acceptRisk),
          flow: opts.flow as "quickstart" | "advanced" | "manual" | undefined,
          mode: opts.mode as "local" | "remote" | undefined,
          authChoice: opts.authChoice as AuthChoice | undefined,
          tokenProvider: opts.tokenProvider as string | undefined,
          token: opts.token as string | undefined,
          tokenProfileId: opts.tokenProfileId as string | undefined,
          tokenExpiresIn: opts.tokenExpiresIn as string | undefined,
          secretInputMode: opts.secretInputMode as SecretInputMode | undefined,
          ...providerAuthOptionValues,
          cloudflareAiGatewayAccountId: opts.cloudflareAiGatewayAccountId as string | undefined,
          cloudflareAiGatewayGatewayId: opts.cloudflareAiGatewayGatewayId as string | undefined,
          customBaseUrl: opts.customBaseUrl as string | undefined,
          customApiKey: opts.customApiKey as string | undefined,
          customModelId: opts.customModelId as string | undefined,
          customProviderId: opts.customProviderId as string | undefined,
          customCompatibility: opts.customCompatibility as "openai" | "anthropic" | undefined,
          gatewayPort:
            typeof gatewayPort === "number" && Number.isFinite(gatewayPort)
              ? gatewayPort
              : undefined,
          gatewayBind: opts.gatewayBind as GatewayBind | undefined,
          gatewayAuth: opts.gatewayAuth as GatewayAuthChoice | undefined,
          gatewayToken: opts.gatewayToken as string | undefined,
          gatewayTokenRefEnv: opts.gatewayTokenRefEnv as string | undefined,
          gatewayPassword: opts.gatewayPassword as string | undefined,
          remoteUrl: opts.remoteUrl as string | undefined,
          remoteToken: opts.remoteToken as string | undefined,
          tailscale: opts.tailscale as TailscaleMode | undefined,
          tailscaleResetOnExit: Boolean(opts.tailscaleResetOnExit),
          reset: Boolean(opts.reset),
          resetScope: opts.resetScope as ResetScope | undefined,
          installDaemon,
          daemonRuntime: opts.daemonRuntime as GatewayDaemonRuntime | undefined,
          skipChannels: Boolean(opts.skipChannels),
          skipSkills: Boolean(opts.skipSkills),
          skipSearch: Boolean(opts.skipSearch),
          skipHealth: Boolean(opts.skipHealth),
          skipUi: Boolean(opts.skipUi),
          outputPreset: opts.outputPreset as OnboardOutputPreset | undefined,
          nodeManager: opts.nodeManager as NodeManagerChoice | undefined,
          json: Boolean(opts.json),
        },
        defaultRuntime,
      );
    });
  });
}
