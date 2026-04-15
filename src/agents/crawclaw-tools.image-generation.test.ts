import { describe, expect, it, vi } from "vitest";
import { createCrawClawTools } from "./crawclaw-tools.js";

vi.mock("../plugins/tools.js", () => ({
  resolvePluginTools: () => [],
  copyPluginToolMeta: () => undefined,
  getPluginToolMeta: () => undefined,
}));

describe("crawclaw tools image generation removal", () => {
  it("does not register image_generate", () => {
    const tools = createCrawClawTools({
      config: {},
      agentDir: "/tmp/crawclaw-agent-main",
    });

    expect(tools.map((tool) => tool.name)).not.toContain("image_generate");
  });
});
