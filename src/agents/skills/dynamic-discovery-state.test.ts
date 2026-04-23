import { describe, expect, it } from "vitest";
import {
  clearDiscoveredSkillDirsForTest,
  getDiscoveredSkillDirs,
  recordDiscoveredSkillDirs,
} from "./dynamic-discovery-state.js";

describe("dynamic-discovery-state", () => {
  it("records unique directories per session", () => {
    clearDiscoveredSkillDirsForTest();

    recordDiscoveredSkillDirs({ sessionId: "session-1" }, ["/tmp/a", " /tmp/b "]);
    recordDiscoveredSkillDirs({ sessionId: "session-1" }, ["/tmp/a", "/tmp/c"]);

    expect(getDiscoveredSkillDirs({ sessionId: "session-1" })).toEqual([
      "/tmp/a",
      "/tmp/b",
      "/tmp/c",
    ]);
  });
});
