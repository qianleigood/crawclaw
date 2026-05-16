import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWizardPrompter as buildWizardPrompter } from "../../test/helpers/wizard-prompter.js";
import type { RuntimeEnv } from "../runtime.js";
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
    vi.clearAllMocks();
  });

  it("does not run NotebookLM onboarding", async () => {
    const prompter = buildWizardPrompter();

    await maybeHandleNotebookLmOnboarding({
      config: {
        memory: {
          notebooklm: {
            enabled: true,
          },
        },
      },
      opts: {},
      prompter,
      runtime: createRuntime(),
    });

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
    expect(prompter.confirm).toHaveBeenCalledTimes(1);
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

  it("keeps NotebookLM disabled when experience capture is enabled", async () => {
    const prompter = buildWizardPrompter({
      confirm: vi.fn(async () => true),
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
    expect(prompter.confirm).toHaveBeenCalledTimes(1);
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
});
