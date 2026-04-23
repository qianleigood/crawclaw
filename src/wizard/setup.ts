import { formatCliCommand } from "../cli/command-format.js";
import { createCliTranslator, resolveCliLocaleFromRuntime } from "../cli/i18n/index.js";
import type {
  GatewayAuthChoice,
  OnboardMode,
  OnboardOptions,
  ResetScope,
} from "../commands/onboard-types.js";
import type { CrawClawConfig } from "../config/config.js";
import { readConfigFileSnapshot, resolveGatewayPort, writeConfigFile } from "../config/config.js";
import { normalizeSecretInputString } from "../config/types.secrets.js";
import {
  buildPluginCompatibilityNotices,
  formatPluginCompatibilityNotice,
} from "../plugins/status.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { resolveUserPath } from "../utils.js";
import { WizardCancelledError, type WizardPrompter } from "./prompts.js";
import { promptNotebookLmEnablement } from "./setup.notebooklm.js";
import {
  applyOnboardOutputPresentationConfig,
  promptOutputPresentationPreset,
} from "./setup.output-presentation.js";
import { resolveSetupSecretInputString } from "./setup.secret-input.js";
import type { QuickstartGatewayDefaults, WizardFlow } from "./setup.types.js";

async function resolveAuthChoiceModelSelectionPolicy(params: {
  authChoice: string;
  config: CrawClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  resolvePreferredProviderForAuthChoice: (params: {
    choice: string;
    config?: CrawClawConfig;
    workspaceDir?: string;
    env?: NodeJS.ProcessEnv;
  }) => Promise<string | undefined>;
}): Promise<{
  preferredProvider?: string;
  promptWhenAuthChoiceProvided: boolean;
  allowKeepCurrent: boolean;
}> {
  const preferredProvider = await params.resolvePreferredProviderForAuthChoice({
    choice: params.authChoice,
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });

  const { resolvePluginProviders, resolveProviderPluginChoice } =
    await import("../plugins/provider-auth-choice.runtime.js");
  const providers = resolvePluginProviders({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
    bundledProviderAllowlistCompat: true,
    bundledProviderVitestCompat: true,
  });
  const resolvedChoice = resolveProviderPluginChoice({
    providers,
    choice: params.authChoice,
  });
  const matchedProvider =
    resolvedChoice?.provider ??
    (preferredProvider
      ? providers.find((provider) => provider.id.trim() === preferredProvider.trim())
      : undefined);
  const setupPolicy =
    resolvedChoice?.wizard?.modelSelection ?? matchedProvider?.wizard?.setup?.modelSelection;

  return {
    preferredProvider,
    promptWhenAuthChoiceProvided: setupPolicy?.promptWhenAuthChoiceProvided === true,
    allowKeepCurrent: setupPolicy?.allowKeepCurrent ?? true,
  };
}

async function requireRiskAcknowledgement(params: {
  opts: OnboardOptions;
  prompter: WizardPrompter;
  t: ReturnType<typeof createCliTranslator>;
}) {
  if (params.opts.acceptRisk === true) {
    return;
  }

  await params.prompter.note(
    params.t("wizard.setup.security.body"),
    params.t("wizard.setup.security.title"),
  );

  const ok = await params.prompter.confirm({
    message: params.t("wizard.setup.security.confirm"),
    initialValue: false,
  });
  if (!ok) {
    throw new WizardCancelledError("risk not accepted");
  }
}

export async function runSetupWizard(
  opts: OnboardOptions,
  runtime: RuntimeEnv = defaultRuntime,
  prompter: WizardPrompter,
) {
  const t = createCliTranslator(resolveCliLocaleFromRuntime(process.argv));
  const onboardHelpers = await import("../commands/onboard-helpers.js");
  onboardHelpers.printWizardHeader(runtime);
  await prompter.intro(t("wizard.setup.intro"));
  await requireRiskAcknowledgement({ opts, prompter, t });

  const snapshot = await readConfigFileSnapshot();
  let baseConfig: CrawClawConfig = snapshot.valid
    ? snapshot.exists
      ? (snapshot.sourceConfig ?? snapshot.runtimeConfig)
      : {}
    : {};

  if (snapshot.exists && !snapshot.valid) {
    await prompter.note(
      onboardHelpers.summarizeExistingConfig(baseConfig),
      t("wizard.setup.invalidConfig.title"),
    );
    if (snapshot.issues.length > 0) {
      await prompter.note(
        [
          ...snapshot.issues.map((iss) => `- ${iss.path}: ${iss.message}`),
          "",
          "Docs: https://docs.crawclaw.ai/gateway/configuration",
        ].join("\n"),
        t("wizard.setup.invalidConfig.issuesTitle"),
      );
    }
    await prompter.outro(
      t("wizard.setup.invalidConfig.outro", {
        doctor: formatCliCommand("crawclaw doctor"),
      }),
    );
    runtime.exit(1);
    return;
  }

  const compatibilityNotices = snapshot.valid
    ? buildPluginCompatibilityNotices({ config: baseConfig })
    : [];
  if (compatibilityNotices.length > 0) {
    await prompter.note(
      [
        `Detected ${compatibilityNotices.length} plugin compatibility notice${compatibilityNotices.length === 1 ? "" : "s"} in the current config.`,
        ...compatibilityNotices
          .slice(0, 4)
          .map((notice) => `- ${formatPluginCompatibilityNotice(notice)}`),
        ...(compatibilityNotices.length > 4
          ? [`- ... +${compatibilityNotices.length - 4} more`]
          : []),
        "",
        `Review: ${formatCliCommand("crawclaw doctor")}`,
        `Inspect: ${formatCliCommand("crawclaw plugins inspect --all")}`,
      ].join("\n"),
      "Plugin compatibility",
    );
  }

  const quickstartHint = t("wizard.setup.flow.quickstartHint", {
    configure: formatCliCommand("crawclaw configure"),
  });
  const manualHint = t("wizard.setup.flow.manualHint");
  const explicitFlowRaw = opts.flow?.trim();
  const normalizedExplicitFlow = explicitFlowRaw === "manual" ? "advanced" : explicitFlowRaw;
  if (
    normalizedExplicitFlow &&
    normalizedExplicitFlow !== "quickstart" &&
    normalizedExplicitFlow !== "advanced"
  ) {
    runtime.error(t("wizard.setup.error.invalidFlow"));
    runtime.exit(1);
    return;
  }
  const explicitFlow: WizardFlow | undefined =
    normalizedExplicitFlow === "quickstart" || normalizedExplicitFlow === "advanced"
      ? normalizedExplicitFlow
      : undefined;
  let flow: WizardFlow =
    explicitFlow ??
    (await prompter.select({
      message: t("wizard.setup.flow.message"),
      options: [
        {
          value: "quickstart",
          label: t("wizard.setup.flow.quickstartLabel"),
          hint: quickstartHint,
        },
        { value: "advanced", label: t("wizard.setup.flow.manualLabel"), hint: manualHint },
      ],
      initialValue: "quickstart",
    }));

  if (opts.mode === "remote" && flow === "quickstart") {
    await prompter.note(
      t("wizard.setup.flow.quickstartRemoteOnly"),
      t("wizard.setup.flow.quickstartLabel"),
    );
    flow = "advanced";
  }

  if (snapshot.exists) {
    await prompter.note(
      onboardHelpers.summarizeExistingConfig(baseConfig),
      t("wizard.setup.existingConfig.title"),
    );

    const action = await prompter.select({
      message: t("wizard.setup.existingConfig.message"),
      options: [
        { value: "keep", label: t("wizard.setup.existingConfig.keep") },
        { value: "modify", label: t("wizard.setup.existingConfig.modify") },
        { value: "reset", label: t("wizard.setup.existingConfig.reset") },
      ],
    });

    if (action === "reset") {
      const workspaceDefault =
        baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE;
      const resetScope = (await prompter.select({
        message: t("wizard.setup.resetScope.message"),
        options: [
          { value: "config", label: t("wizard.setup.resetScope.config") },
          {
            value: "config+creds+sessions",
            label: t("wizard.setup.resetScope.configCredsSessions"),
          },
          {
            value: "full",
            label: t("wizard.setup.resetScope.full"),
          },
        ],
      })) as ResetScope;
      await onboardHelpers.handleReset(resetScope, resolveUserPath(workspaceDefault), runtime);
      baseConfig = {};
    }
  }

  const quickstartGateway: QuickstartGatewayDefaults = (() => {
    const hasExisting =
      typeof baseConfig.gateway?.port === "number" ||
      baseConfig.gateway?.bind !== undefined ||
      baseConfig.gateway?.auth?.mode !== undefined ||
      baseConfig.gateway?.auth?.token !== undefined ||
      baseConfig.gateway?.auth?.password !== undefined ||
      baseConfig.gateway?.customBindHost !== undefined ||
      baseConfig.gateway?.tailscale?.mode !== undefined;

    const bindRaw = baseConfig.gateway?.bind;
    const bind =
      bindRaw === "loopback" ||
      bindRaw === "lan" ||
      bindRaw === "auto" ||
      bindRaw === "custom" ||
      bindRaw === "tailnet"
        ? bindRaw
        : "loopback";

    let authMode: GatewayAuthChoice = "token";
    if (
      baseConfig.gateway?.auth?.mode === "token" ||
      baseConfig.gateway?.auth?.mode === "password"
    ) {
      authMode = baseConfig.gateway.auth.mode;
    } else if (baseConfig.gateway?.auth?.token) {
      authMode = "token";
    } else if (baseConfig.gateway?.auth?.password) {
      authMode = "password";
    }

    const tailscaleRaw = baseConfig.gateway?.tailscale?.mode;
    const tailscaleMode =
      tailscaleRaw === "off" || tailscaleRaw === "serve" || tailscaleRaw === "funnel"
        ? tailscaleRaw
        : "off";

    return {
      hasExisting,
      port: resolveGatewayPort(baseConfig),
      bind,
      authMode,
      tailscaleMode,
      token: baseConfig.gateway?.auth?.token,
      password: baseConfig.gateway?.auth?.password,
      customBindHost: baseConfig.gateway?.customBindHost,
      tailscaleResetOnExit: baseConfig.gateway?.tailscale?.resetOnExit ?? false,
    };
  })();

  if (flow === "quickstart") {
    const formatBind = (value: "loopback" | "lan" | "auto" | "custom" | "tailnet") => {
      if (value === "loopback") {
        return t("wizard.setup.quickstart.bind.loopback");
      }
      if (value === "lan") {
        return t("wizard.setup.quickstart.bind.lan");
      }
      if (value === "custom") {
        return t("wizard.setup.quickstart.bind.custom");
      }
      if (value === "tailnet") {
        return t("wizard.setup.quickstart.bind.tailnet");
      }
      return t("wizard.setup.quickstart.bind.auto");
    };
    const formatAuth = (value: GatewayAuthChoice) => {
      if (value === "token") {
        return t("wizard.setup.quickstart.auth.token");
      }
      return t("wizard.setup.quickstart.auth.password");
    };
    const formatTailscale = (value: "off" | "serve" | "funnel") => {
      if (value === "off") {
        return t("wizard.setup.quickstart.tailscale.off");
      }
      if (value === "serve") {
        return t("wizard.setup.quickstart.tailscale.serve");
      }
      return t("wizard.setup.quickstart.tailscale.funnel");
    };
    const quickstartLines = quickstartGateway.hasExisting
      ? [
          t("wizard.setup.quickstart.keepExisting"),
          t("wizard.setup.quickstart.gatewayPort", { port: quickstartGateway.port }),
          t("wizard.setup.quickstart.gatewayBind", { bind: formatBind(quickstartGateway.bind) }),
          ...(quickstartGateway.bind === "custom" && quickstartGateway.customBindHost
            ? [
                t("wizard.setup.quickstart.gatewayCustomIp", {
                  host: quickstartGateway.customBindHost,
                }),
              ]
            : []),
          t("wizard.setup.quickstart.gatewayAuth", {
            auth: formatAuth(quickstartGateway.authMode),
          }),
          t("wizard.setup.quickstart.tailscaleExposure", {
            mode: formatTailscale(quickstartGateway.tailscaleMode),
          }),
          t("wizard.setup.quickstart.directToChannels"),
        ]
      : [
          t("wizard.setup.quickstart.gatewayPort", { port: quickstartGateway.port }),
          t("wizard.setup.quickstart.gatewayBind", {
            bind: t("wizard.setup.quickstart.bind.loopback"),
          }),
          t("wizard.setup.quickstart.gatewayAuth", {
            auth: t("wizard.setup.quickstart.auth.token"),
          }),
          t("wizard.setup.quickstart.tailscaleExposure", {
            mode: t("wizard.setup.quickstart.tailscale.off"),
          }),
          t("wizard.setup.quickstart.directToChannels"),
        ];
    await prompter.note(quickstartLines.join("\n"), t("wizard.setup.flow.quickstartLabel"));
  }

  const localPort = resolveGatewayPort(baseConfig);
  const localUrl = `ws://127.0.0.1:${localPort}`;
  let localGatewayToken = process.env.CRAWCLAW_GATEWAY_TOKEN;
  try {
    const resolvedGatewayToken = await resolveSetupSecretInputString({
      config: baseConfig,
      value: baseConfig.gateway?.auth?.token,
      path: "gateway.auth.token",
      env: process.env,
    });
    if (resolvedGatewayToken) {
      localGatewayToken = resolvedGatewayToken;
    }
  } catch (error) {
    await prompter.note(
      [
        t("wizard.setup.secretRefProbeFailed", { path: "gateway.auth.token" }),
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
      t("wizard.setup.gatewayAuthTitle"),
    );
  }
  let localGatewayPassword = process.env.CRAWCLAW_GATEWAY_PASSWORD;
  try {
    const resolvedGatewayPassword = await resolveSetupSecretInputString({
      config: baseConfig,
      value: baseConfig.gateway?.auth?.password,
      path: "gateway.auth.password",
      env: process.env,
    });
    if (resolvedGatewayPassword) {
      localGatewayPassword = resolvedGatewayPassword;
    }
  } catch (error) {
    await prompter.note(
      [
        t("wizard.setup.secretRefProbeFailed", { path: "gateway.auth.password" }),
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
      t("wizard.setup.gatewayAuthTitle"),
    );
  }

  const localProbe = await onboardHelpers.probeGatewayReachable({
    url: localUrl,
    token: localGatewayToken,
    password: localGatewayPassword,
  });
  const remoteUrl = baseConfig.gateway?.remote?.url?.trim() ?? "";
  let remoteGatewayToken = normalizeSecretInputString(baseConfig.gateway?.remote?.token);
  try {
    const resolvedRemoteGatewayToken = await resolveSetupSecretInputString({
      config: baseConfig,
      value: baseConfig.gateway?.remote?.token,
      path: "gateway.remote.token",
      env: process.env,
    });
    if (resolvedRemoteGatewayToken) {
      remoteGatewayToken = resolvedRemoteGatewayToken;
    }
  } catch (error) {
    await prompter.note(
      [
        t("wizard.setup.secretRefProbeFailed", { path: "gateway.remote.token" }),
        error instanceof Error ? error.message : String(error),
      ].join("\n"),
      t("wizard.setup.gatewayAuthTitle"),
    );
  }
  const remoteProbe = remoteUrl
    ? await onboardHelpers.probeGatewayReachable({
        url: remoteUrl,
        token: remoteGatewayToken,
      })
    : null;

  const mode =
    opts.mode ??
    (flow === "quickstart"
      ? "local"
      : ((await prompter.select({
          message: t("wizard.setup.mode.message"),
          options: [
            {
              value: "local",
              label: t("wizard.setup.mode.localLabel"),
              hint: localProbe.ok
                ? t("wizard.setup.mode.localReachable", { url: localUrl })
                : t("wizard.setup.mode.localMissing", { url: localUrl }),
            },
            {
              value: "remote",
              label: t("wizard.setup.mode.remoteLabel"),
              hint: !remoteUrl
                ? t("wizard.setup.mode.remoteMissing")
                : remoteProbe?.ok
                  ? t("wizard.setup.mode.remoteReachable", { url: remoteUrl })
                  : t("wizard.setup.mode.remoteUnreachable", { url: remoteUrl }),
            },
          ],
        })) as OnboardMode));

  if (mode === "remote") {
    const { promptRemoteGatewayConfig } = await import("../commands/onboard-remote.js");
    const { logConfigUpdated } = await import("../config/logging.js");
    let nextConfig = await promptRemoteGatewayConfig(baseConfig, prompter, {
      secretInputMode: opts.secretInputMode,
    });
    nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
    await writeConfigFile(nextConfig);
    logConfigUpdated(runtime);
    await prompter.outro(t("wizard.setup.remoteConfigured"));
    return;
  }

  const workspaceInput =
    opts.workspace ??
    (flow === "quickstart"
      ? (baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE)
      : await prompter.text({
          message: t("wizard.setup.workspaceDirectory"),
          initialValue: baseConfig.agents?.defaults?.workspace ?? onboardHelpers.DEFAULT_WORKSPACE,
        }));

  const workspaceDir = resolveUserPath(workspaceInput.trim() || onboardHelpers.DEFAULT_WORKSPACE);

  const { applyLocalSetupWorkspaceConfig } = await import("../commands/onboard-config.js");
  let nextConfig: CrawClawConfig = applyLocalSetupWorkspaceConfig(baseConfig, workspaceDir);

  const { ensureAuthProfileStore } = await import("../agents/auth-profiles.runtime.js");
  const { promptAuthChoiceGrouped } = await import("../commands/auth-choice-prompt.js");
  const { promptCustomApiConfig } = await import("../commands/onboard-custom.js");
  const { applyAuthChoice, resolvePreferredProviderForAuthChoice, warnIfModelConfigLooksOff } =
    await import("../commands/auth-choice.js");
  const { applyPrimaryModel, promptDefaultModel } = await import("../commands/model-picker.js");

  const authStore = ensureAuthProfileStore(undefined, {
    allowKeychainPrompt: false,
  });
  const authChoiceFromPrompt = opts.authChoice === undefined;
  const authChoice =
    opts.authChoice ??
    (await promptAuthChoiceGrouped({
      prompter,
      store: authStore,
      includeSkip: true,
      config: nextConfig,
      workspaceDir,
    }));

  if (authChoice === "custom-api-key") {
    const customResult = await promptCustomApiConfig({
      prompter,
      runtime,
      config: nextConfig,
      secretInputMode: opts.secretInputMode,
    });
    nextConfig = customResult.config;
  } else {
    const authResult = await applyAuthChoice({
      authChoice,
      config: nextConfig,
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
        tokenProvider: opts.tokenProvider,
        token: opts.authChoice === "apiKey" && opts.token ? opts.token : undefined,
      },
    });
    nextConfig = authResult.config;

    if (authResult.agentModelOverride) {
      nextConfig = applyPrimaryModel(nextConfig, authResult.agentModelOverride);
    }
  }

  const authChoiceModelSelectionPolicy =
    authChoice === "custom-api-key"
      ? undefined
      : await resolveAuthChoiceModelSelectionPolicy({
          authChoice,
          config: nextConfig,
          workspaceDir,
          resolvePreferredProviderForAuthChoice,
        });
  const shouldPromptModelSelection =
    authChoice !== "custom-api-key" &&
    (authChoiceFromPrompt || authChoiceModelSelectionPolicy?.promptWhenAuthChoiceProvided === true);
  if (shouldPromptModelSelection) {
    const modelSelection = await promptDefaultModel({
      config: nextConfig,
      prompter,
      allowKeep: authChoiceModelSelectionPolicy?.allowKeepCurrent ?? true,
      ignoreAllowlist: true,
      includeProviderPluginSetups: true,
      preferredProvider: authChoiceModelSelectionPolicy?.preferredProvider,
      workspaceDir,
      runtime,
    });
    if (modelSelection.config) {
      nextConfig = modelSelection.config;
    }
    if (modelSelection.model) {
      nextConfig = applyPrimaryModel(nextConfig, modelSelection.model);
    }
  }

  await warnIfModelConfigLooksOff(nextConfig, prompter);

  const { configureGatewayForSetup } = await import("./setup.gateway-config.js");
  const gateway = await configureGatewayForSetup({
    flow,
    baseConfig,
    nextConfig,
    localPort,
    quickstartGateway,
    secretInputMode: opts.secretInputMode,
    prompter,
    runtime,
  });
  nextConfig = gateway.nextConfig;
  const settings = gateway.settings;

  if (opts.skipChannels) {
    await prompter.note(t("wizard.setup.skip.channels"), t("wizard.setup.skip.channelsTitle"));
  } else {
    const { listChannelPlugins } = await import("../channels/plugins/index.js");
    const { setupChannels } = await import("../commands/onboard-channels.js");
    const quickstartAllowFromChannels =
      flow === "quickstart"
        ? listChannelPlugins()
            .filter((plugin) => plugin.meta.quickstartAllowFrom)
            .map((plugin) => plugin.id)
        : [];
    nextConfig = await setupChannels(nextConfig, runtime, prompter, {
      allowSignalInstall: true,
      forceAllowFromChannels: quickstartAllowFromChannels,
      skipDmPolicyPrompt: flow === "quickstart",
      skipConfirm: flow === "quickstart",
      quickstartDefaults: flow === "quickstart",
      secretInputMode: opts.secretInputMode,
    });
  }

  const outputPreset = opts.outputPreset ?? (await promptOutputPresentationPreset(prompter));
  nextConfig = applyOnboardOutputPresentationConfig(nextConfig, outputPreset);
  nextConfig = await promptNotebookLmEnablement({
    config: nextConfig,
    prompter,
    nonInteractive: opts.nonInteractive,
  });

  await writeConfigFile(nextConfig);
  const { logConfigUpdated } = await import("../config/logging.js");
  logConfigUpdated(runtime);
  await onboardHelpers.ensureWorkspaceAndSessions(workspaceDir, runtime, {
    skipBootstrap: Boolean(nextConfig.agents?.defaults?.skipBootstrap),
  });

  if (opts.skipSearch) {
    await prompter.note(t("wizard.setup.skip.search"), t("wizard.setup.skip.searchTitle"));
  } else {
    const { setupSearch } = await import("../commands/onboard-search.js");
    nextConfig = await setupSearch(nextConfig, runtime, prompter, {
      quickstartDefaults: flow === "quickstart",
      secretInputMode: opts.secretInputMode,
    });
  }

  if (opts.skipSkills) {
    await prompter.note(t("wizard.setup.skip.skills"), t("wizard.setup.skip.skillsTitle"));
  } else {
    const { setupSkills } = await import("../commands/onboard-skills.js");
    nextConfig = await setupSkills(nextConfig, workspaceDir, runtime, prompter);
  }

  // Setup internal hooks
  const { setupInternalHooks } = await import("../commands/onboard-hooks.js");
  nextConfig = await setupInternalHooks(nextConfig, runtime, prompter);

  nextConfig = onboardHelpers.applyWizardMetadata(nextConfig, { command: "onboard", mode });
  await writeConfigFile(nextConfig);

  const { finalizeSetupWizard } = await import("./setup.finalize.js");
  const { launchedTui } = await finalizeSetupWizard({
    flow,
    opts,
    baseConfig,
    nextConfig,
    workspaceDir,
    settings,
    prompter,
    runtime,
  });
  if (launchedTui) {
    return;
  }
}
