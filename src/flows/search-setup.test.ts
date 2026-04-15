import { describe, expect, it, vi } from "vitest";
import { createWizardPrompter } from "../../test/helpers/wizard-prompter.js";
import { createNonExitingRuntime } from "../runtime.js";
import { runSearchSetupFlow } from "./search-setup.js";

describe("runSearchSetupFlow", () => {
  it("selects key-free open-websearch without prompting for an API key", async () => {
    const select = vi.fn().mockResolvedValueOnce("open-websearch");
    const text = vi.fn();
    const prompter = createWizardPrompter({
      select: select as never,
      text: text as never,
    });

    const next = await runSearchSetupFlow(
      { plugins: { allow: ["open-websearch"] } },
      createNonExitingRuntime(),
      prompter,
    );

    expect(text).not.toHaveBeenCalled();
    expect(next.tools?.web?.search).toMatchObject({
      provider: "open-websearch",
      enabled: true,
    });
    expect(next.plugins?.entries?.["open-websearch"]?.enabled).toBe(true);
  });

  it("preserves disabled web_search state for key-free providers", async () => {
    const select = vi.fn().mockResolvedValueOnce("open-websearch");
    const prompter = createWizardPrompter({
      select: select as never,
    });

    const next = await runSearchSetupFlow(
      {
        plugins: {
          allow: ["open-websearch"],
        },
        tools: {
          web: {
            search: {
              provider: "open-websearch",
              enabled: false,
            },
          },
        },
      },
      createNonExitingRuntime(),
      prompter,
    );

    expect(next.tools?.web?.search).toMatchObject({
      provider: "open-websearch",
      enabled: false,
    });
  });
});
