import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../test-utils/tracked-temp-dirs.js";
import { createCrawClawTools } from "./crawclaw-tools.js";

const tempDirs = createTrackedTempDirs();

afterEach(async () => {
  await tempDirs.cleanup();
});

describe("createCrawClawTools promotion judge registration", () => {
  it("registers the verdict tool only for promotion-judge runs", async () => {
    const workspaceDir = await tempDirs.make("crawclaw-tools-promotion-judge-");

    const ordinary = new Set(createCrawClawTools({ workspaceDir }).map((tool) => tool.name));
    const judge = new Set(
      createCrawClawTools({
        workspaceDir,
        specialAgentSpawnSource: "promotion-judge",
      }).map((tool) => tool.name),
    );

    expect(ordinary.has("submit_promotion_verdict")).toBe(false);
    expect(judge.has("submit_promotion_verdict")).toBe(true);
  });
});
