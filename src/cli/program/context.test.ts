import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProgramContext } from "./context.js";

const resolveCliChannelOptionsMock = vi.hoisted(() => vi.fn(() => ["telegram", "whatsapp"]));
const loadConfigMock = vi.hoisted(() => vi.fn(() => ({ cli: {} })));

vi.mock("../../version.js", () => ({
  VERSION: "9.9.9-test",
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("../channel-options.js", () => ({
  resolveCliChannelOptions: resolveCliChannelOptionsMock,
}));

describe("createProgramContext", () => {
  beforeEach(() => {
    loadConfigMock.mockReset().mockReturnValue({ cli: {} });
  });

  it("builds program context from version and resolved channel options", () => {
    resolveCliChannelOptionsMock.mockClear().mockReturnValue(["telegram", "whatsapp"]);
    const ctx = createProgramContext();
    expect(ctx).toEqual({
      programVersion: "9.9.9-test",
      locale: "en",
      t: expect.any(Function),
      channelOptions: ["telegram", "whatsapp"],
      messageChannelOptions: "telegram|whatsapp",
      agentChannelOptions: "last|telegram|whatsapp",
    });
    expect(resolveCliChannelOptionsMock).toHaveBeenCalledOnce();
  });

  it("handles empty channel options", () => {
    resolveCliChannelOptionsMock.mockClear().mockReturnValue([]);
    const ctx = createProgramContext();
    expect(ctx).toEqual({
      programVersion: "9.9.9-test",
      locale: "en",
      t: expect.any(Function),
      channelOptions: [],
      messageChannelOptions: "",
      agentChannelOptions: "last",
    });
    expect(resolveCliChannelOptionsMock).toHaveBeenCalledOnce();
  });

  it("does not resolve channel options before access", () => {
    resolveCliChannelOptionsMock.mockClear();
    createProgramContext();
    expect(resolveCliChannelOptionsMock).not.toHaveBeenCalled();
  });

  it("reuses one channel option resolution across all getters", () => {
    resolveCliChannelOptionsMock.mockClear().mockReturnValue(["telegram"]);
    const ctx = createProgramContext();
    expect(ctx.channelOptions).toEqual(["telegram"]);
    expect(ctx.messageChannelOptions).toBe("telegram");
    expect(ctx.agentChannelOptions).toBe("last|telegram");
    expect(resolveCliChannelOptionsMock).toHaveBeenCalledOnce();
  });

  it("reads program version without resolving channel options", () => {
    resolveCliChannelOptionsMock.mockClear();
    const ctx = createProgramContext();
    expect(ctx.programVersion).toBe("9.9.9-test");
    expect(ctx.locale).toBe("en");
    expect(resolveCliChannelOptionsMock).not.toHaveBeenCalled();
  });

  it("prefers --lang over config language", () => {
    const ctx = createProgramContext({
      argv: ["node", "crawclaw", "--lang", "zh-CN", "status"],
      configLanguage: "en",
    });
    expect(ctx.locale).toBe("zh-CN");
    expect(ctx.t("common.confirm")).toBe("确认");
  });

  it("falls back to config language when --lang is absent", () => {
    const ctx = createProgramContext({
      argv: ["node", "crawclaw", "status"],
      configLanguage: "zh-CN",
    });
    expect(ctx.locale).toBe("zh-CN");
  });

  it("falls back to env language when config cannot be loaded", () => {
    loadConfigMock.mockImplementation(() => {
      throw new Error("Invalid config");
    });
    const ctx = createProgramContext({
      argv: ["node", "crawclaw", "doctor", "--fix"],
      envLanguage: "zh-CN",
    });
    expect(ctx.locale).toBe("zh-CN");
  });
});
