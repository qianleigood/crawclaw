import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/index.js";

const mocks = vi.hoisted(() => ({
  note: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  note: mocks.note,
}));

import { note } from "./note.js";

describe("note i18n", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveCliLocale("zh-CN");
  });

  it("localizes exact English note message and title", () => {
    note("Tailscale requires bind=loopback. Adjusting bind to loopback.", "Note");

    expect(mocks.note).toHaveBeenCalledWith(
      expect.stringContaining("Tailscale 要求监听地址为 loopback"),
      expect.stringContaining("提示"),
    );
  });
});
