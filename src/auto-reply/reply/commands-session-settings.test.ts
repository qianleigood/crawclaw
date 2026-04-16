import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  handleFastCommand,
  handleSendPolicyCommand,
  handleUsageCommand,
} from "./commands-session.js";
import { buildCommandTestParams } from "./commands.test-harness.js";

const baseCfg = {
  commands: { text: true },
  session: { mainKey: "main", scope: "per-sender" },
} as CrawClawConfig;

function createOwnedCommandParams(commandBody: string) {
  return buildCommandTestParams(commandBody, baseCfg, {
    Provider: "telegram",
    Surface: "telegram",
    OriginatingChannel: "telegram",
    SenderId: "user-1",
    OwnerAllowFrom: ["user-1"],
  });
}

function attachSessionState(commandBody: string, entryOverrides: Partial<SessionEntry> = {}) {
  const params = createOwnedCommandParams(commandBody);
  const entry: SessionEntry = {
    sessionId: "sess-1",
    updatedAt: 1,
    ...entryOverrides,
  };
  params.sessionStore = {
    [params.sessionKey]: entry,
  };
  params.sessionEntry = params.sessionStore[params.sessionKey];
  return params;
}

describe("session setting commands", () => {
  it("routes /send through the shared session patch semantics", async () => {
    const params = attachSessionState("/send on");

    const result = await handleSendPolicyCommand(params, true);

    expect(result?.shouldContinue).toBe(false);
    expect(result?.reply?.text).toBe("⚙️ Send policy set to on.");
    expect(params.sessionEntry?.sendPolicy).toBe("allow");
    expect(params.sessionStore?.[params.sessionKey]?.sendPolicy).toBe("allow");
  });

  it("clears inherited send policy through the shared session patch path", async () => {
    const params = attachSessionState("/send inherit", {
      sendPolicy: "deny",
    });

    const result = await handleSendPolicyCommand(params, true);

    expect(result?.reply?.text).toBe("⚙️ Send policy set to inherit.");
    expect(params.sessionEntry?.sendPolicy).toBeUndefined();
    expect(params.sessionStore?.[params.sessionKey]?.sendPolicy).toBeUndefined();
  });

  it("toggles /usage through the shared session patch path", async () => {
    const params = attachSessionState("/usage");

    const result = await handleUsageCommand(params, true);

    expect(result?.reply?.text).toBe("⚙️ Usage footer: tokens.");
    expect(params.sessionEntry?.responseUsage).toBe("tokens");
    expect(params.sessionStore?.[params.sessionKey]?.responseUsage).toBe("tokens");
  });

  it("persists /fast through the shared session patch path", async () => {
    const params = attachSessionState("/fast on", {
      fastMode: false,
    });

    const result = await handleFastCommand(params, true);

    expect(result?.reply?.text).toBe("⚙️ Fast mode enabled.");
    expect(params.sessionEntry?.fastMode).toBe(true);
    expect(params.sessionStore?.[params.sessionKey]?.fastMode).toBe(true);
  });
});
