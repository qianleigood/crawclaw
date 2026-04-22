import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/index.js";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  text: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  select: mocks.select,
  text: mocks.text,
}));

import { select, text } from "./configure.shared.js";

describe("configure.shared localized prompts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveCliLocale("zh-CN");
  });

  it("localizes exact English prompt text, labels, hints, and placeholders", async () => {
    mocks.select.mockResolvedValueOnce("token");
    mocks.text.mockResolvedValueOnce("ok");

    await select({
      message: "Gateway auth",
      options: [{ value: "token", label: "Token", hint: "Recommended default" }],
    });
    await text({
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
