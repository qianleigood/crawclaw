import { describe, expect, it, vi } from "vitest";
import { createWizardPrompter } from "../../test/helpers/wizard-prompter.js";
import { createNonExitingRuntime } from "../runtime.js";
import { runSearchSetupFlow } from "./search-setup.js";

describe("runSearchSetupFlow", () => {
  it("selects key-free searxng without prompting for an API key", async () => {
    const select = vi.fn().mockResolvedValueOnce("searxng");
    const text = vi.fn();
    const prompter = createWizardPrompter({
      select: select as never,
      text: text as never,
    });

    const next = await runSearchSetupFlow(
      { plugins: { allow: ["searxng"] } },
      createNonExitingRuntime(),
      prompter,
    );

    expect(text).not.toHaveBeenCalled();
    expect(next.tools?.web?.search).toMatchObject({
      provider: "searxng",
      enabled: true,
    });
    expect(next.plugins?.entries?.["searxng"]?.enabled).toBe(true);
  });

  it("preserves disabled web_search state for key-free providers", async () => {
    const select = vi.fn().mockResolvedValueOnce("searxng");
    const prompter = createWizardPrompter({
      select: select as never,
    });

    const next = await runSearchSetupFlow(
      {
        plugins: {
          allow: ["searxng"],
        },
        tools: {
          web: {
            search: {
              provider: "searxng",
              enabled: false,
            },
          },
        },
      },
      createNonExitingRuntime(),
      prompter,
    );

    expect(next.tools?.web?.search).toMatchObject({
      provider: "searxng",
      enabled: false,
    });
  });
});
