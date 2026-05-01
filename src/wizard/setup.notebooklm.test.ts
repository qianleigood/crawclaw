import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWizardPrompter as buildWizardPrompter } from "../../test/helpers/wizard-prompter.js";
import type { RuntimeEnv } from "../runtime.js";

const getNotebookLmProviderState = vi.hoisted(() => vi.fn());
const clearNotebookLmProviderStateCache = vi.hoisted(() => vi.fn());
const inferNotebookLmLoginCommand = vi.hoisted(() => vi.fn());
const runNotebookLmLoginCommand = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../memory/notebooklm/provider-state.js", () => ({
  getNotebookLmProviderState,
  clearNotebookLmProviderStateCache,
}));

vi.mock("../memory/notebooklm/login.js", () => ({
  inferNotebookLmLoginCommand,
  runNotebookLmLoginCommand,
}));

import { maybeHandleNotebookLmOnboarding, promptNotebookLmEnablement } from "./setup.notebooklm.js";

function createRuntime(): RuntimeEnv {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  };
}

describe("setup.notebooklm", () => {
  beforeEach(() => {
    getNotebookLmProviderState.mockReset();
    clearNotebookLmProviderStateCache.mockReset();
    inferNotebookLmLoginCommand.mockReset();
    runNotebookLmLoginCommand.mockReset();
    runNotebookLmLoginCommand.mockResolvedValue(undefined);
  });

  it("skips when NotebookLM is disabled", async () => {
    const prompter = buildWizardPrompter();

    await maybeHandleNotebookLmOnboarding({
      config: {},
      opts: {},
      prompter,
      runtime: createRuntime(),
    });

    expect(getNotebookLmProviderState).not.toHaveBeenCalled();
    expect(prompter.note).not.toHaveBeenCalled();
  });

  it("enables local experience memory without NotebookLM", async () => {
    const prompter = buildWizardPrompter({
      confirm: vi.fn(
        async (params) => params.message === "Enable experience capture and local sync queue?",
      ),
      text: vi.fn(async () => ""),
    });

    const nextConfig = await promptNotebookLmEnablement({
      config: {},
      prompter,
    });

    expect(prompter.confirm).toHaveBeenCalledWith({
      message: "Enable experience capture and local sync queue?",
      initialValue: true,
    });
    expect(prompter.confirm).toHaveBeenCalledWith({
      message: "Enable NotebookLM experience recall and sync?",
      initialValue: false,
    });
    expect(prompter.text).not.toHaveBeenCalled();
    expect(nextConfig).toEqual(
      expect.objectContaining({
        memory: expect.objectContaining({
          experience: expect.objectContaining({
            enabled: true,
          }),
          notebooklm: expect.objectContaining({
            enabled: false,
          }),
        }),
      }),
    );
  });

  it("disables experience memory without prompting for NotebookLM", async () => {
    const prompter = buildWizardPrompter({
      confirm: vi.fn(async () => false),
      text: vi.fn(async () => ""),
    });

    const nextConfig = await promptNotebookLmEnablement({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
          },
        },
      },
      prompter,
    });

    expect(prompter.confirm).toHaveBeenCalledTimes(1);
    expect(prompter.confirm).toHaveBeenCalledWith({
      message: "Enable experience capture and local sync queue?",
      initialValue: true,
    });
    expect(prompter.text).not.toHaveBeenCalled();
    expect(nextConfig).toEqual(
      expect.objectContaining({
        memory: expect.objectContaining({
          experience: expect.objectContaining({
            enabled: false,
          }),
          notebooklm: expect.objectContaining({
            enabled: false,
          }),
        }),
      }),
    );
  });

  it("adds NotebookLM enablement to the onboarding flow", async () => {
    const prompter = buildWizardPrompter({
      confirm: vi.fn(async () => true),
      text: vi.fn(async (params) => {
        if (params.message === "NotebookLM CLI command") {
          return "nlm";
        }
        if (params.message === "NotebookLM notebook ID") {
          return "experience-notebook";
        }
        return "";
      }),
    });

    const nextConfig = await promptNotebookLmEnablement({
      config: {},
      prompter,
    });

    expect(prompter.confirm).toHaveBeenCalledWith({
      message: "Enable experience capture and local sync queue?",
      initialValue: true,
    });
    expect(prompter.confirm).toHaveBeenCalledWith({
      message: "Enable NotebookLM experience recall and sync?",
      initialValue: false,
    });
    expect(prompter.text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "NotebookLM CLI command",
        initialValue: "nlm",
      }),
    );
    expect(prompter.text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "NotebookLM notebook ID",
      }),
    );
    expect(nextConfig).toEqual(
      expect.objectContaining({
        memory: expect.objectContaining({
          notebooklm: expect.objectContaining({
            enabled: true,
            cli: expect.objectContaining({
              enabled: true,
              command: "nlm",
              notebookId: "experience-notebook",
            }),
          }),
        }),
      }),
    );
  });

  it("keeps NotebookLM config unchanged in non-interactive mode", async () => {
    const prompter = buildWizardPrompter({
      confirm: vi.fn(async () => false),
    });
    const config = {
      memory: {
        notebooklm: {
          enabled: true,
          cli: {
            command: "/tmp/notebooklm-cli.py",
          },
        },
      },
    };

    const nextConfig = await promptNotebookLmEnablement({
      config,
      prompter,
      nonInteractive: true,
    });

    expect(prompter.confirm).not.toHaveBeenCalled();
    expect(nextConfig).toEqual(config);
  });

  it("offers NotebookLM login during onboarding when provider state recommends it", async () => {
    getNotebookLmProviderState
      .mockResolvedValueOnce({
        enabled: true,
        ready: false,
        lifecycle: "expired",
        reason: "auth_expired",
        recommendedAction: "crawclaw memory login",
        profile: "default",
        notebookId: "nb-1",
        refreshAttempted: false,
        refreshSucceeded: false,
        lastValidatedAt: "2026-04-17T00:00:00.000Z",
      })
      .mockResolvedValueOnce({
        enabled: true,
        ready: true,
        lifecycle: "ready",
        reason: null,
        recommendedAction: "crawclaw memory status",
        profile: "default",
        notebookId: "nb-1",
        refreshAttempted: false,
        refreshSucceeded: true,
        lastValidatedAt: "2026-04-17T00:01:00.000Z",
      });
    inferNotebookLmLoginCommand.mockReturnValue({ command: "nlm", args: ["login"] });
    const prompter = buildWizardPrompter({
      confirm: vi.fn(async () => true),
    });

    await maybeHandleNotebookLmOnboarding({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
            cli: { command: "/tmp/notebooklm-cli.py" },
          },
        },
      },
      opts: {},
      prompter,
      runtime: createRuntime(),
    });

    expect(inferNotebookLmLoginCommand).toHaveBeenCalledTimes(1);
    expect(runNotebookLmLoginCommand).toHaveBeenCalledWith("nlm", ["login"]);
    expect(clearNotebookLmProviderStateCache).toHaveBeenCalledTimes(1);
    expect(prompter.confirm).toHaveBeenCalledWith({
      message: "Run NotebookLM login now?",
      initialValue: true,
    });
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("NotebookLM experience is now ready."),
      "NotebookLM",
    );
  });

  it("only shows the recommended action in non-interactive mode", async () => {
    getNotebookLmProviderState.mockResolvedValue({
      enabled: true,
      ready: false,
      lifecycle: "expired",
      reason: "profile_missing",
      recommendedAction: "crawclaw memory login",
      profile: "default",
      notebookId: "nb-1",
      refreshAttempted: false,
      refreshSucceeded: false,
      lastValidatedAt: "2026-04-17T00:00:00.000Z",
    });
    const prompter = buildWizardPrompter();

    await maybeHandleNotebookLmOnboarding({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
            cli: { command: "/tmp/notebooklm-cli.py" },
          },
        },
      },
      opts: { nonInteractive: true },
      prompter,
      runtime: createRuntime(),
    });

    expect(prompter.confirm).not.toHaveBeenCalled();
    expect(runNotebookLmLoginCommand).not.toHaveBeenCalled();
    expect(prompter.note).toHaveBeenCalledWith(
      expect.stringContaining("Recommended action: crawclaw memory login"),
      "NotebookLM",
    );
  });
});
