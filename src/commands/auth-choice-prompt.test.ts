import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/text.js";
import type { WizardPrompter } from "../wizard/prompts.js";

const mocks = vi.hoisted(() => ({
  buildAuthChoiceGroups: vi.fn(),
}));

vi.mock("./auth-choice-options.js", () => ({
  buildAuthChoiceGroups: mocks.buildAuthChoiceGroups,
}));

import { promptAuthChoiceGrouped } from "./auth-choice-prompt.js";

function createPrompter() {
  return {
    select: vi.fn(),
    note: vi.fn(async () => {}),
  } as unknown as WizardPrompter & {
    select: ReturnType<typeof vi.fn>;
    note: ReturnType<typeof vi.fn>;
  };
}

describe("promptAuthChoiceGrouped", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveCliLocale("zh-CN");
  });

  it("localizes auth choice prompt chrome in zh-CN", async () => {
    const prompter = createPrompter();
    mocks.buildAuthChoiceGroups.mockReturnValue({
      groups: [
        {
          value: "anthropic",
          label: "Anthropic",
          hint: "Any OpenAI or Anthropic compatible endpoint",
          options: [
            { value: "token", label: "Anthropic token (paste setup-token)" },
            { value: "api-key", label: "API key" },
          ],
        },
      ],
      skipOption: { value: "skip", label: "Skip for now" },
    });
    prompter.select
      .mockResolvedValueOnce("anthropic")
      .mockResolvedValueOnce("__back")
      .mockResolvedValueOnce("anthropic")
      .mockResolvedValueOnce("token");

    const choice = await promptAuthChoiceGrouped({
      prompter,
      store: { version: 1, profiles: {} },
      includeSkip: true,
    });

    expect(choice).toBe("token");
    expect(prompter.select).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "模型/认证 provider",
        options: expect.arrayContaining([
          expect.objectContaining({
            label: "Anthropic",
            hint: "任何兼容 OpenAI 或 Anthropic 的端点",
          }),
          expect.objectContaining({ label: "暂时跳过" }),
        ]),
      }),
    );
    expect(prompter.select).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "Anthropic 认证方式",
        options: expect.arrayContaining([
          expect.objectContaining({ label: "Anthropic token（粘贴 setup-token）" }),
          expect.objectContaining({ label: "返回" }),
        ]),
      }),
    );
  });

  it("localizes missing auth methods note in zh-CN", async () => {
    const prompter = createPrompter();
    mocks.buildAuthChoiceGroups.mockReturnValue({
      groups: [{ value: "anthropic", label: "Anthropic", options: [] }],
      skipOption: { value: "skip", label: "Skip for now" },
    });
    prompter.select.mockResolvedValueOnce("anthropic").mockResolvedValueOnce("skip");

    const choice = await promptAuthChoiceGrouped({
      prompter,
      store: { version: 1, profiles: {} },
      includeSkip: true,
    });

    expect(choice).toBe("skip");
    expect(prompter.note).toHaveBeenCalledWith("该 provider 没有可用的认证方式。", "模型/认证选择");
  });
});
