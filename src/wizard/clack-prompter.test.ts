import { beforeEach, describe, expect, it, vi } from "vitest";
import { WizardCancelledError } from "./prompts.js";

const mocks = vi.hoisted(() => {
  const CANCEL = Symbol("cancel");
  return {
    CANCEL,
    select: vi.fn(),
    text: vi.fn(),
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
  select: mocks.select,
  spinner: vi.fn(() => ({ start: vi.fn(), message: vi.fn(), stop: vi.fn() })),
  text: mocks.text,
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

  it("localizes exact English prompt text, labels, hints, and placeholders", async () => {
    mocks.select.mockResolvedValueOnce("token");
    mocks.text.mockResolvedValueOnce("ok");
    const prompter = createClackPrompter();

    await prompter.select({
      message: "Gateway auth",
      options: [{ value: "token", label: "Token", hint: "Recommended default" }],
    });
    await prompter.text({
      message: "Gateway token (blank to generate)",
      placeholder: "Needed for multi-machine or non-loopback access",
    });

    expect(mocks.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("网关认证方式"),
        options: [
          expect.objectContaining({
            label: "Token",
            hint: expect.stringContaining("推荐默认值"),
          }),
        ],
      }),
    );
    expect(mocks.text).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Gateway token（留空则自动生成）"),
        placeholder: "多机器或非 loopback 访问时需要",
      }),
    );
  });
});
