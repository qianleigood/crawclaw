import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { resetPluginRuntimeStateForTest } from "../../plugins/runtime.js";

describe("group runtime loading", () => {
  beforeEach(() => {
    resetPluginRuntimeStateForTest();
    vi.resetModules();
  });

  it("keeps prompt helpers off the heavy group runtime", async () => {
    const groupsRuntimeLoads = vi.fn();
    vi.doMock("./groups.runtime.js", async (importOriginal) => {
      groupsRuntimeLoads();
      return await importOriginal<typeof import("./groups.runtime.js")>();
    });
    const groups = await import("./groups.js");

    expect(groupsRuntimeLoads).not.toHaveBeenCalled();
    expect(
      groups.buildGroupChatContext({
        sessionCtx: {
          ChatType: "group",
          GroupSubject: "Ops",
          Provider: "weixin",
        },
      }),
    ).toContain('You are in the Weixin group chat "Ops".');
    expect(
      groups.buildGroupIntro({
        cfg: {} as CrawClawConfig,
        sessionCtx: { Provider: "weixin" },
        defaultActivation: "mention",
        silentToken: "NO_REPLY",
      }),
    ).toContain("Weixin IDs:");
    expect(groupsRuntimeLoads).not.toHaveBeenCalled();
    vi.doUnmock("./groups.runtime.js");
  });

  it("loads the group runtime only when requireMention resolution needs it", async () => {
    const groupsRuntimeLoads = vi.fn();
    vi.doMock("./groups.runtime.js", async (importOriginal) => {
      groupsRuntimeLoads();
      return await importOriginal<typeof import("./groups.runtime.js")>();
    });
    const groups = await import("./groups.js");

    await expect(
      groups.resolveGroupRequireMention({
        cfg: {
          channels: {
            ddingtalk: {
              channels: {
                C123: { requireMention: false },
              },
            },
          },
        },
        ctx: {
          Provider: "ddingtalk",
          From: "ddingtalk:channel:C123",
          GroupSubject: "#general",
        },
        groupResolution: {
          key: "ddingtalk:group:C123",
          channel: "ddingtalk",
          id: "C123",
          chatType: "group",
        },
      }),
    ).resolves.toBe(false);
    expect(groupsRuntimeLoads).toHaveBeenCalled();
    vi.doUnmock("./groups.runtime.js");
  });
});
