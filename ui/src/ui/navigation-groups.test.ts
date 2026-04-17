import { describe, expect, it } from "vitest";
import { SIMPLE_TAB_GROUPS, TAB_GROUPS, tabFromPath } from "./navigation.ts";

describe("TAB_GROUPS", () => {
  it("keeps platform settings grouped under the settings rail", () => {
    const settings = TAB_GROUPS.find((group) => group.label === "settings");
    expect(settings?.tabs).toEqual([
      "config",
      "communications",
      "appearance",
      "automation",
      "infrastructure",
      "aiAgents",
    ]);
  });

  it("surfaces the platform information architecture in advanced mode", () => {
    expect(TAB_GROUPS.map((group) => group.label)).toEqual([
      "chat",
      "workspace",
      "automation",
      "runtime",
      "observe",
      "settings",
    ]);
  });

  it("routes every published settings slice", () => {
    expect(tabFromPath("/communications")).toBe("communications");
    expect(tabFromPath("/appearance")).toBe("appearance");
    expect(tabFromPath("/automation")).toBe("automation");
    expect(tabFromPath("/infrastructure")).toBe("infrastructure");
    expect(tabFromPath("/ai-agents")).toBe("aiAgents");
    expect(tabFromPath("/config")).toBe("config");
  });

  it("keeps simple mode focused on five primary product tabs", () => {
    expect(SIMPLE_TAB_GROUPS).toHaveLength(1);
    expect(SIMPLE_TAB_GROUPS[0]?.tabs).toEqual([
      "overview",
      "chat",
      "channels",
      "workflows",
      "agents",
    ]);
  });
});
