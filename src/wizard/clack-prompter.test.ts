import { beforeEach, describe, expect, it, vi } from "vitest";
import { WizardCancelledError } from "./prompts.js";

const mocks = vi.hoisted(() => {
  const CANCEL = Symbol("cancel");
  return {
    CANCEL,
    confirm: vi.fn(),
    cancel: vi.fn(),
    isCancel: vi.fn((value: unknown) => value === CANCEL),
  };
});

vi.mock("@clack/prompts", () => ({
  autocompleteMultiselect: vi.fn(),
  cancel: mocks.cancel,
  confirm: mocks.confirm,
  intro: vi.fn(),
  isCancel: mocks.isCancel,
  multiselect: vi.fn(),
  outro: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), message: vi.fn(), stop: vi.fn() })),
  text: vi.fn(),
}));

vi.mock("../config/config.js", () => ({
  loadConfig: () => ({ cli: { language: "zh-CN" } }),
}));

import { createClackPrompter } from "./clack-prompter.js";

describe("createClackPrompter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("localizes confirm controls from CLI locale", async () => {
    mocks.confirm.mockResolvedValueOnce(true);
    const prompter = createClackPrompter();

    await expect(prompter.confirm({ message: "继续吗？", initialValue: true })).resolves.toBe(true);
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.any(String),
        active: "确认",
        inactive: "取消",
      }),
    );
  });

  it("emits a localized cancel message", async () => {
    mocks.confirm.mockResolvedValueOnce(mocks.CANCEL);
    const prompter = createClackPrompter();

    await expect(prompter.confirm({ message: "继续吗？" })).rejects.toBeInstanceOf(
      WizardCancelledError,
    );
    expect(mocks.cancel).toHaveBeenCalledWith("已取消设置。");
  });
});
