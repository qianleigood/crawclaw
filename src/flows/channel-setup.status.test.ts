import { describe, expect, it } from "vitest";
import type { ChannelChoice } from "../commands/onboard-types.js";
import { resolveChannelSetupSelectionContributions } from "./channel-setup.status.js";

function entry(id: ChannelChoice, label: string, profile?: "primary-cn" | "optional" | "legacy") {
  return {
    id,
    meta: {
      id,
      label,
      selectionLabel: label,
      ...(profile ? { profile } : {}),
    },
  };
}

describe("resolveChannelSetupSelectionContributions", () => {
  it("limits quickstart channel choices to primary China channels when present", () => {
    const contributions = resolveChannelSetupSelectionContributions({
      entries: [
        entry("feishu", "Feishu", "primary-cn"),
        entry("qqbot", "QQ Bot", "primary-cn"),
        entry("telegram", "Telegram", "optional"),
        entry("discord", "Discord", "legacy"),
      ],
      statusByChannel: new Map(),
      resolveDisabledHint: () => undefined,
      profile: "primary-cn",
    });

    expect(contributions.map((item) => item.channel)).toEqual(["feishu", "qqbot"]);
  });

  it("keeps optional and legacy channels visible outside quickstart", () => {
    const contributions = resolveChannelSetupSelectionContributions({
      entries: [
        entry("feishu", "Feishu", "primary-cn"),
        entry("telegram", "Telegram", "optional"),
        entry("discord", "Discord", "legacy"),
      ],
      statusByChannel: new Map(),
      resolveDisabledHint: () => undefined,
    });

    expect(contributions.map((item) => item.channel)).toEqual(["feishu", "telegram", "discord"]);
  });
});
