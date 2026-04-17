import { describe, expect, it } from "vitest";
import {
  isDiscordSurface,
  isMatrixSurface,
  isTelegramSurface,
  resolveChannelAccountId,
  resolveCommandSurfaceChannel,
} from "./command-surface-context.js";

describe("resolveCommandSurfaceChannel", () => {
  it("prefers originating channel over command, surface, and provider fallbacks", () => {
    expect(
      resolveCommandSurfaceChannel({
        ctx: {
          OriginatingChannel: "telegram",
          Surface: "discord",
          Provider: "slack",
        },
        command: {
          channel: "matrix",
        },
      }),
    ).toBe("telegram");
  });

  it("falls back through command, surface, and provider", () => {
    expect(
      resolveCommandSurfaceChannel({
        ctx: {
          Surface: "discord",
        },
        command: {
          channel: "matrix",
        },
      }),
    ).toBe("matrix");
    expect(
      resolveCommandSurfaceChannel({
        ctx: {
          Surface: "discord",
        },
        command: {},
      }),
    ).toBe("discord");
    expect(
      resolveCommandSurfaceChannel({
        ctx: {
          Provider: "telegram",
        },
        command: {},
      }),
    ).toBe("telegram");
  });
});

describe("surface predicates", () => {
  const params = {
    ctx: { OriginatingChannel: "telegram" },
    command: {},
  };

  it("detects telegram, discord, and matrix surfaces", () => {
    expect(isTelegramSurface(params)).toBe(true);
    expect(isDiscordSurface(params)).toBe(false);
    expect(isMatrixSurface(params)).toBe(false);
  });
});

describe("resolveChannelAccountId", () => {
  it("defaults account ids to default", () => {
    expect(resolveChannelAccountId({ ctx: {} })).toBe("default");
    expect(resolveChannelAccountId({ ctx: { AccountId: " " } })).toBe("default");
  });

  it("preserves explicit account ids", () => {
    expect(resolveChannelAccountId({ ctx: { AccountId: "acct-1" } })).toBe("acct-1");
  });
});
