import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createWizardPrompter as buildWizardPrompter } from "../../test/helpers/wizard-prompter.js";
import type { PluginCompatibilityNotice } from "../plugins/status.js";
import type { RuntimeEnv } from "../runtime.js";
import { setActiveCliLocale } from "../terminal/i18n/text.js";
import type { WizardPrompter, WizardSelectParams } from "./prompts.js";
import { runSetupWizard } from "./setup.js";

const ensureAuthProfileStore = vi.hoisted(() => vi.fn(() => ({ profiles: {} })));
const promptAuthChoiceGrouped = vi.hoisted(() => vi.fn(async () => "skip"));
const applyAuthChoice = vi.hoisted(() => vi.fn(async (args) => ({ config: args.config })));
const resolvePreferredProviderForAuthChoice = vi.hoisted(() => vi.fn(async () => "demo-provider"));
const warnIfModelConfigLooksOff = vi.hoisted(() => vi.fn(async () => {}));
const applyPrimaryModel = vi.hoisted(() => vi.fn((cfg) => cfg));
const promptDefaultModel = vi.hoisted(() => vi.fn(async () => ({ config: null, model: null })));
const promptCustomApiConfig = vi.hoisted(() => vi.fn(async (args) => ({ config: args.config })));
const configureGatewayForSetup = vi.hoisted(() =>
  vi.fn(async (args) => ({
    nextConfig: args.nextConfig,
    settings: {
      port: args.localPort ?? 18789,
      bind: "loopback",
      authMode: "token",
      gatewayToken: "test-token",
      tailscaleMode: "off",
      tailscaleResetOnExit: false,
    },
  })),
);
const finalizeSetupWizard = vi.hoisted(() =>
  vi.fn(async (options) => {
    if (!options.nextConfig?.tools?.web?.search?.provider) {
      await options.prompter.note("Web search was skipped.", "Web search");
    }
    return { launchedTui: true };
  }),
);
const listChannelPlugins = vi.hoisted(() => vi.fn(() => []));
const logConfigUpdated = vi.hoisted(() => vi.fn(() => {}));
const setupInternalHooks = vi.hoisted(() => vi.fn(async (cfg) => cfg));

const setupChannels = vi.hoisted(() => vi.fn(async (cfg) => cfg));
const setupSkills = vi.hoisted(() => vi.fn(async (cfg) => cfg));
const healthCommand = vi.hoisted(() => vi.fn(async () => {}));
const ensureWorkspaceAndSessions = vi.hoisted(() => vi.fn(async () => {}));
const writeConfigFile = vi.hoisted(() => vi.fn(async () => {}));
const resolveGatewayPort = vi.hoisted(() =>
  vi.fn((_cfg?: unknown, env?: NodeJS.ProcessEnv) => {
    const raw = env?.CRAWCLAW_GATEWAY_PORT ?? process.env.CRAWCLAW_GATEWAY_PORT;
    const port = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isFinite(port) && port > 0 ? port : 18789;
  }),
);
const readConfigFileSnapshot = vi.hoisted(() =>
  vi.fn(async () => ({
    path: "/tmp/.crawclaw/crawclaw.json",
    exists: false,
    raw: null as string | null,
    parsed: {},
    sourceConfig: {},
    resolved: {},
    valid: true,
    runtimeConfig: {},
    config: {},
    issues: [] as Array<{ path: string; message: string }>,
    warnings: [] as Array<{ path: string; message: string }>,
    legacyIssues: [] as Array<{ path: string; message: string }>,
  })),
);
const ensureSystemdUserLingerInteractive = vi.hoisted(() => vi.fn(async () => {}));
const isSystemdUserServiceAvailable = vi.hoisted(() => vi.fn(async () => true));
const probeGatewayReachable = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const buildPluginCompatibilityNotices = vi.hoisted(() =>
  vi.fn((): PluginCompatibilityNotice[] => []),
);
const formatPluginCompatibilityNotice = vi.hoisted(() =>
  vi.fn((notice: PluginCompatibilityNotice) => `${notice.pluginId} ${notice.message}`),
);

function getWizardNoteCalls(note: WizardPrompter["note"]) {
  return (note as unknown as { mock: { calls: unknown[][] } }).mock.calls;
}

vi.mock("../control/onboard-channels.js", () => ({
  setupChannels,
}));

vi.mock("../control/onboard-skills.js", () => ({
  setupSkills,
}));

vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore,
}));

vi.mock("../control/auth-choice-prompt.js", () => ({
  promptAuthChoiceGrouped,
}));

vi.mock("../control/auth-choice.js", () => ({
  applyAuthChoice,
  resolvePreferredProviderForAuthChoice,
  warnIfModelConfigLooksOff,
}));

vi.mock("../control/model-picker.js", () => ({
  applyPrimaryModel,
  promptDefaultModel,
}));

vi.mock("../control/onboard-custom.js", () => ({
  promptCustomApiConfig,
}));

vi.mock("../control/health.js", () => ({
  healthCommand,
}));

vi.mock("../control/onboard-hooks.js", () => ({
  setupInternalHooks,
}));

vi.mock("../config/config.js", () => ({
  DEFAULT_GATEWAY_PORT: 18789,
  resolveGatewayPort,
  readConfigFileSnapshot,
  writeConfigFile,
}));

vi.mock("../control/onboard-helpers.js", () => ({
  DEFAULT_WORKSPACE: "/tmp/crawclaw-workspace",
  applyWizardMetadata: (cfg: unknown) => cfg,
  summarizeExistingConfig: () => "summary",
  handleReset: async () => {},
  randomToken: () => "test-token",
  normalizeGatewayTokenInput: (value: unknown) => ({
    ok: true,
    token: typeof value === "string" ? value.trim() : "",
    error: null,
  }),
  validateGatewayPasswordInput: () => ({ ok: true, error: null }),
  ensureWorkspaceAndSessions,
  printWizardHeader: vi.fn(),
  probeGatewayReachable,
  waitForGatewayReachable: vi.fn(async () => {}),
  resolveBrowserClientsLinks: vi.fn(() => ({
    httpUrl: "http://127.0.0.1:18789",
    wsUrl: "ws://127.0.0.1:18789",
  })),
}));

vi.mock("../control/systemd-linger.js", () => ({
  ensureSystemdUserLingerInteractive,
}));

vi.mock("../daemon/systemd.js", () => ({
  isSystemdUserServiceAvailable,
}));

vi.mock("../plugins/status.js", () => ({
  buildPluginCompatibilityNotices,
  formatPluginCompatibilityNotice,
}));

vi.mock("../channels/plugins/index.js", () => ({
  listChannelPlugins,
}));

vi.mock("../config/logging.js", () => ({
  logConfigUpdated,
}));

vi.mock("./setup.gateway-config.js", () => ({
  configureGatewayForSetup,
}));

vi.mock("./setup.finalize.js", () => ({
  finalizeSetupWizard,
}));

function createRuntime(opts?: { throwsOnExit?: boolean }): RuntimeEnv {
  if (opts?.throwsOnExit) {
    return {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn((code: number) => {
        throw new Error(`exit:${code}`);
      }),
    };
  }

  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("runSetupWizard", () => {
  let suiteRoot = "";
  beforeAll(async () => {
    suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-onboard-suite-"));
  });

  afterAll(async () => {
    await fs.rm(suiteRoot, { recursive: true, force: true });
    suiteRoot = "";
  });

  it("localizes the interactive security warning when zh-CN is active", async () => {
    const previousLang = process.env.CRAWCLAW_LANG;
    process.env.CRAWCLAW_LANG = "zh-CN";
    const note: WizardPrompter["note"] = vi.fn(async () => {});
    const confirm: WizardPrompter["confirm"] = vi.fn(async () => true);
    const prompter = buildWizardPrompter({ note, confirm });
    const runtime = createRuntime();

    try {
      await runSetupWizard(
        {
          acceptRisk: false,
          flow: "quickstart",
          authChoice: "skip",
          installDaemon: false,
          outputPreset: "balanced",
          skipChannels: true,
          skipSkills: true,
          skipSearch: true,
          skipHealth: true,
          skipUi: true,
        },
        runtime,
        prompter,
      );
    } finally {
      if (previousLang === undefined) {
        delete process.env.CRAWCLAW_LANG;
      } else {
        process.env.CRAWCLAW_LANG = previousLang;
      }
      setActiveCliLocale("en");
    }

    expect(note).toHaveBeenCalledWith(expect.stringContaining("安全警告"), "安全");
    expect(
      String((note as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]),
    ).not.toContain("Security warning");
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("我理解"),
      }),
    );
  });

  it("exits when config is invalid", async () => {
    readConfigFileSnapshot.mockResolvedValueOnce({
      path: "/tmp/.crawclaw/crawclaw.json",
      exists: true,
      raw: "{}",
      parsed: {},
      sourceConfig: {},
      resolved: {},
      valid: false,
      runtimeConfig: {},
      config: {},
      issues: [{ path: "routing.allowFrom", message: "Legacy key" }],
      warnings: [],
      legacyIssues: [{ path: "routing.allowFrom", message: "Legacy key" }],
    });

    const select = vi.fn(
      async (_params: WizardSelectParams<unknown>) => "quickstart",
    ) as unknown as WizardPrompter["select"];
    const prompter = buildWizardPrompter({ select });
    const runtime = createRuntime({ throwsOnExit: true });

    await expect(
      runSetupWizard(
        {
          acceptRisk: true,
          flow: "quickstart",
          authChoice: "skip",
          installDaemon: false,
          skipChannels: true,
          skipSkills: true,
          skipSearch: true,
          skipHealth: true,
          skipUi: true,
        },
        runtime,
        prompter,
      ),
    ).rejects.toThrow("exit:1");

    expect(select).not.toHaveBeenCalled();
    expect(prompter.outro).toHaveBeenCalled();
  });

  it("skips prompts and setup steps when flags are set", async () => {
    const select = vi.fn(
      async (_params: WizardSelectParams<unknown>) => "quickstart",
    ) as unknown as WizardPrompter["select"];
    const multiselect: WizardPrompter["multiselect"] = vi.fn(async () => []);
    const prompter = buildWizardPrompter({ select, multiselect });
    const runtime = createRuntime({ throwsOnExit: true });

    await runSetupWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        authChoice: "skip",
        installDaemon: false,
        outputPreset: "balanced",
        skipChannels: true,
        skipSkills: true,
        skipSearch: true,
        skipHealth: true,
        skipUi: true,
      },
      runtime,
      prompter,
    );

    expect(select).not.toHaveBeenCalled();
    expect(setupChannels).not.toHaveBeenCalled();
    expect(setupSkills).not.toHaveBeenCalled();
    expect(healthCommand).not.toHaveBeenCalled();
  });

  it("shows the web search hint at the end of setup", async () => {
    const prevBraveKey = process.env.BRAVE_API_KEY;
    delete process.env.BRAVE_API_KEY;

    try {
      const note: WizardPrompter["note"] = vi.fn(async () => {});
      const prompter = buildWizardPrompter({ note });
      const runtime = createRuntime();

      await runSetupWizard(
        {
          acceptRisk: true,
          flow: "quickstart",
          authChoice: "skip",
          installDaemon: false,
          outputPreset: "balanced",
          skipChannels: true,
          skipSkills: true,
          skipSearch: true,
          skipHealth: true,
          skipUi: true,
        },
        runtime,
        prompter,
      );

      const calls = getWizardNoteCalls(note);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.some((call) => call?.[1] === "Web search")).toBe(true);
    } finally {
      if (prevBraveKey === undefined) {
        delete process.env.BRAVE_API_KEY;
      } else {
        process.env.BRAVE_API_KEY = prevBraveKey;
      }
    }
  });

  it("does not load TS provider setup policy for explicit auth choices", async () => {
    promptDefaultModel.mockClear();
    const prompter = buildWizardPrompter({});
    const runtime = createRuntime();

    await runSetupWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        authChoice: "ollama",
        installDaemon: false,
        outputPreset: "balanced",
        skipSkills: true,
        skipSearch: true,
        skipHealth: true,
        skipUi: true,
      },
      runtime,
      prompter,
    );

    expect(promptDefaultModel).not.toHaveBeenCalled();
  });

  it("shows plugin compatibility notices for an existing valid config", async () => {
    buildPluginCompatibilityNotices.mockReturnValue([
      {
        pluginId: "legacy-plugin",
        code: "hook-only",
        severity: "info",
        message:
          "is hook-only. This remains a supported compatibility path, but it has not migrated to explicit capability registration yet.",
      },
    ]);
    readConfigFileSnapshot.mockResolvedValueOnce({
      path: "/tmp/.crawclaw/crawclaw.json",
      exists: true,
      raw: "{}",
      parsed: {},
      resolved: {
        gateway: {},
      },
      valid: true,
      runtimeConfig: {
        gateway: {},
      },
      sourceConfig: {
        gateway: {},
      },
      config: {
        gateway: {},
      },
      issues: [],
      warnings: [],
      legacyIssues: [],
    });

    const note: WizardPrompter["note"] = vi.fn(async () => {});
    const select = vi.fn(async (opts: WizardSelectParams<unknown>) => {
      if (opts.message === "Config handling") {
        return "keep";
      }
      return "quickstart";
    }) as unknown as WizardPrompter["select"];
    const prompter = buildWizardPrompter({ note, select });
    const runtime = createRuntime();

    await runSetupWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        authChoice: "skip",
        installDaemon: false,
        outputPreset: "balanced",
        skipChannels: true,
        skipSkills: true,
        skipSearch: true,
        skipHealth: true,
        skipUi: true,
      },
      runtime,
      prompter,
    );

    const calls = getWizardNoteCalls(note);
    expect(calls.some((call) => call?.[1] === "Plugin compatibility")).toBe(true);
    expect(
      calls.some((call) => {
        const body = call?.[0];
        return typeof body === "string" && body.includes("legacy-plugin");
      }),
    ).toBe(true);
  });

  it("resolves gateway.auth.password SecretRef for local setup probe", async () => {
    const previous = process.env.CRAWCLAW_GATEWAY_PASSWORD;
    process.env.CRAWCLAW_GATEWAY_PASSWORD = "gateway-ref-password"; // pragma: allowlist secret
    probeGatewayReachable.mockClear();
    readConfigFileSnapshot.mockResolvedValueOnce({
      path: "/tmp/.crawclaw/crawclaw.json",
      exists: true,
      raw: "{}",
      parsed: {},
      resolved: {
        gateway: {
          auth: {
            mode: "password",
            password: {
              source: "env",
              provider: "default",
              id: "CRAWCLAW_GATEWAY_PASSWORD",
            },
          },
        },
      },
      valid: true,
      runtimeConfig: {
        gateway: {
          auth: {
            mode: "password",
            password: {
              source: "env",
              provider: "default",
              id: "CRAWCLAW_GATEWAY_PASSWORD",
            },
          },
        },
      },
      sourceConfig: {
        gateway: {
          auth: {
            mode: "password",
            password: {
              source: "env",
              provider: "default",
              id: "CRAWCLAW_GATEWAY_PASSWORD",
            },
          },
        },
      },
      config: {
        gateway: {
          auth: {
            mode: "password",
            password: {
              source: "env",
              provider: "default",
              id: "CRAWCLAW_GATEWAY_PASSWORD",
            },
          },
        },
      },
      issues: [],
      warnings: [],
      legacyIssues: [],
    });
    const select = vi.fn(async (opts: WizardSelectParams<unknown>) => {
      if (opts.message === "Config handling") {
        return "keep";
      }
      return "quickstart";
    }) as unknown as WizardPrompter["select"];
    const prompter = buildWizardPrompter({ select });
    const runtime = createRuntime();

    try {
      await runSetupWizard(
        {
          acceptRisk: true,
          flow: "quickstart",
          mode: "local",
          authChoice: "skip",
          installDaemon: false,
          outputPreset: "balanced",
          skipChannels: true,
          skipSkills: true,
          skipSearch: true,
          skipHealth: true,
          skipUi: true,
        },
        runtime,
        prompter,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.CRAWCLAW_GATEWAY_PASSWORD;
      } else {
        process.env.CRAWCLAW_GATEWAY_PASSWORD = previous;
      }
    }

    expect(probeGatewayReachable).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "ws://127.0.0.1:18789",
        password: "gateway-ref-password", // pragma: allowlist secret
      }),
    );
  });

  it("passes secretInputMode through to local gateway config step", async () => {
    configureGatewayForSetup.mockClear();
    const prompter = buildWizardPrompter({});
    const runtime = createRuntime();

    await runSetupWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        mode: "local",
        authChoice: "skip",
        installDaemon: false,
        outputPreset: "balanced",
        skipChannels: true,
        skipSkills: true,
        skipSearch: true,
        skipHealth: true,
        skipUi: true,
        secretInputMode: "ref", // pragma: allowlist secret
      },
      runtime,
      prompter,
    );

    expect(configureGatewayForSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        secretInputMode: "ref", // pragma: allowlist secret
      }),
    );
  });

  it("shows the resolved gateway port in quickstart for fresh envs", async () => {
    const previousPort = process.env.CRAWCLAW_GATEWAY_PORT;
    process.env.CRAWCLAW_GATEWAY_PORT = "18791";
    const note: WizardPrompter["note"] = vi.fn(async () => {});
    const prompter = buildWizardPrompter({ note });
    const runtime = createRuntime();

    try {
      await runSetupWizard(
        {
          acceptRisk: true,
          flow: "quickstart",
          authChoice: "skip",
          installDaemon: false,
          outputPreset: "balanced",
          skipChannels: true,
          skipSkills: true,
          skipSearch: true,
          skipHealth: true,
          skipUi: true,
        },
        runtime,
        prompter,
      );
    } finally {
      if (previousPort === undefined) {
        delete process.env.CRAWCLAW_GATEWAY_PORT;
      } else {
        process.env.CRAWCLAW_GATEWAY_PORT = previousPort;
      }
    }

    const calls = (note as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      calls.some(
        (call) =>
          call?.[1] === "QuickStart" &&
          typeof call?.[0] === "string" &&
          call[0].includes("Gateway port: 18791"),
      ),
    ).toBe(true);
  });

  it("prompts for a unified output preset and applies it before writing config", async () => {
    writeConfigFile.mockClear();
    const select = vi.fn(async (opts: WizardSelectParams<unknown>) => {
      if (opts.message === "Output and presentation") {
        return "operator";
      }
      return "quickstart";
    }) as unknown as WizardPrompter["select"];
    const prompter = buildWizardPrompter({
      select,
      confirm: vi.fn(
        async (params) =>
          params.message === "Enable experience capture and local sync queue?" ||
          params.message === "Enable NotebookLM experience recall and sync?",
      ),
    });
    const runtime = createRuntime();

    await runSetupWizard(
      {
        acceptRisk: true,
        flow: "quickstart",
        authChoice: "skip",
        installDaemon: false,
        skipChannels: true,
        skipSkills: true,
        skipSearch: true,
        skipHealth: true,
        skipUi: true,
      },
      runtime,
      prompter,
    );

    expect(select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Output and presentation",
      }),
    );
    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({
        memory: expect.objectContaining({
          notebooklm: expect.objectContaining({
            enabled: true,
          }),
        }),
        agents: expect.objectContaining({
          defaults: expect.objectContaining({
            verboseDefault: "full",
            blockStreamingDefault: "on",
          }),
        }),
        acp: expect.objectContaining({
          stream: expect.objectContaining({
            visibilityMode: "full",
            deliveryMode: "live",
          }),
        }),
      }),
    );
  });
});
