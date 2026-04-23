import { afterEach, describe, expect, it } from "vitest";
import { clearSlackChannelTypeCacheForTest, resolveSlackChannelType } from "./channel-type.js";
import type { CrawClawConfig } from "./runtime-api.js";

describe("resolveSlackChannelType", () => {
  afterEach(() => {
    clearSlackChannelTypeCacheForTest();
  });

  it("does not reuse cached type when channel config changes for the same account", async () => {
    const first = await resolveSlackChannelType({
      cfg: { channels: { slack: { dm: { groupChannels: ["C1"] } } } } as CrawClawConfig,
      accountId: "default",
      channelId: "C1",
    });
    const second = await resolveSlackChannelType({
      cfg: { channels: { slack: { channels: { C1: {} } } } } as CrawClawConfig,
      accountId: "default",
      channelId: "C1",
    });

    expect(first).toBe("group");
    expect(second).toBe("channel");
  });
});
