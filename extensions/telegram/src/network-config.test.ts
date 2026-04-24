import type { TelegramNetworkConfig } from "crawclaw/plugin-sdk/config-runtime";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let resolveTelegramAutoSelectFamilyDecision: typeof import("./network-config.js").resolveTelegramAutoSelectFamilyDecision;
let resolveTelegramDnsResultOrderDecision: typeof import("./network-config.js").resolveTelegramDnsResultOrderDecision;

async function loadModule() {
  ({ resolveTelegramAutoSelectFamilyDecision, resolveTelegramDnsResultOrderDecision } =
    await import("./network-config.js"));
}

describe("resolveTelegramAutoSelectFamilyDecision", () => {
  beforeAll(async () => {
    await loadModule();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      name: "prefers env enable over env disable",
      env: {
        CRAWCLAW_TELEGRAM_ENABLE_AUTO_SELECT_FAMILY: "1",
        CRAWCLAW_TELEGRAM_DISABLE_AUTO_SELECT_FAMILY: "1",
      },
      expected: {
        value: true,
        source: "env:CRAWCLAW_TELEGRAM_ENABLE_AUTO_SELECT_FAMILY",
      },
    },
    {
      name: "uses env disable when set",
      env: { CRAWCLAW_TELEGRAM_DISABLE_AUTO_SELECT_FAMILY: "1" },
      expected: {
        value: false,
        source: "env:CRAWCLAW_TELEGRAM_DISABLE_AUTO_SELECT_FAMILY",
      },
    },
    {
      name: "prefers env enable over config",
      env: { CRAWCLAW_TELEGRAM_ENABLE_AUTO_SELECT_FAMILY: "1" },
      network: { autoSelectFamily: false },
      expected: {
        value: true,
        source: "env:CRAWCLAW_TELEGRAM_ENABLE_AUTO_SELECT_FAMILY",
      },
    },
    {
      name: "prefers env disable over config",
      env: { CRAWCLAW_TELEGRAM_DISABLE_AUTO_SELECT_FAMILY: "1" },
      network: { autoSelectFamily: true },
      expected: {
        value: false,
        source: "env:CRAWCLAW_TELEGRAM_DISABLE_AUTO_SELECT_FAMILY",
      },
    },
    {
      name: "uses config override when provided",
      env: {},
      network: { autoSelectFamily: true },
      expected: { value: true, source: "config" },
    },
  ])("$name", ({ env, network, expected }) => {
    if (!resolveTelegramAutoSelectFamilyDecision) {
      throw new Error("network-config module not loaded");
    }
    const decision = resolveTelegramAutoSelectFamilyDecision({
      env,
      network,
      nodeMajor: 22,
    });
    expect(decision).toEqual(expected);
  });

  it("defaults to enable on Node 22", () => {
    const decision = resolveTelegramAutoSelectFamilyDecision({ env: {}, nodeMajor: 22 });
    expect(decision).toEqual({ value: true, source: "default-node22" });
  });

  it("returns null when no decision applies", () => {
    const decision = resolveTelegramAutoSelectFamilyDecision({ env: {}, nodeMajor: 20 });
    expect(decision).toEqual({ value: null });
  });
});

describe("resolveTelegramDnsResultOrderDecision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      name: "uses env override when provided",
      env: { CRAWCLAW_TELEGRAM_DNS_RESULT_ORDER: "verbatim" },
      nodeMajor: 22,
      expected: {
        value: "verbatim",
        source: "env:CRAWCLAW_TELEGRAM_DNS_RESULT_ORDER",
      },
    },
    {
      name: "normalizes trimmed env values",
      env: { CRAWCLAW_TELEGRAM_DNS_RESULT_ORDER: "  IPV4FIRST  " },
      nodeMajor: 20,
      expected: {
        value: "ipv4first",
        source: "env:CRAWCLAW_TELEGRAM_DNS_RESULT_ORDER",
      },
    },
    {
      name: "uses config override when provided",
      network: { dnsResultOrder: "ipv4first" },
      nodeMajor: 20,
      expected: { value: "ipv4first", source: "config" },
    },
    {
      name: "normalizes trimmed config values",
      network: { dnsResultOrder: "  Verbatim  " } as TelegramNetworkConfig & {
        dnsResultOrder: string;
      },
      nodeMajor: 20,
      expected: { value: "verbatim", source: "config" },
    },
    {
      name: "ignores invalid env values and falls back to config",
      env: { CRAWCLAW_TELEGRAM_DNS_RESULT_ORDER: "bogus" },
      network: { dnsResultOrder: "ipv4first" },
      nodeMajor: 20,
      expected: { value: "ipv4first", source: "config" },
    },
    {
      name: "ignores invalid env and config values before applying Node 22 default",
      env: { CRAWCLAW_TELEGRAM_DNS_RESULT_ORDER: "bogus" },
      network: { dnsResultOrder: "invalid" } as TelegramNetworkConfig & { dnsResultOrder: string },
      nodeMajor: 22,
      expected: { value: "ipv4first", source: "default-node22" },
    },
  ] satisfies Array<{
    name: string;
    env?: NodeJS.ProcessEnv;
    network?: TelegramNetworkConfig | (TelegramNetworkConfig & { dnsResultOrder: string });
    nodeMajor: number;
    expected: ReturnType<typeof resolveTelegramDnsResultOrderDecision>;
  }>)("$name", ({ env, network, nodeMajor, expected }) => {
    const decision = resolveTelegramDnsResultOrderDecision({
      env,
      network,
      nodeMajor,
    });
    expect(decision).toEqual(expected);
  });

  it("defaults to ipv4first on Node 22", () => {
    const decision = resolveTelegramDnsResultOrderDecision({ nodeMajor: 22 });
    expect(decision).toEqual({ value: "ipv4first", source: "default-node22" });
  });

  it("returns null when no dns decision applies", () => {
    const decision = resolveTelegramDnsResultOrderDecision({ nodeMajor: 20 });
    expect(decision).toEqual({ value: null });
  });
});
