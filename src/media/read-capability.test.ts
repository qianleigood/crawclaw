import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { resolveAgentScopedOutboundMediaAccess } from "./read-capability.js";

describe("resolveAgentScopedOutboundMediaAccess", () => {
  it("preserves caller-provided workspaceDir from mediaAccess", () => {
    const result = resolveAgentScopedOutboundMediaAccess({
      cfg: {} as CrawClawConfig,
      mediaAccess: { workspaceDir: "/tmp/media-workspace" },
    });

    expect(result).toMatchObject({ workspaceDir: "/tmp/media-workspace" });
  });

  it("prefers explicit workspaceDir over mediaAccess.workspaceDir", () => {
    const result = resolveAgentScopedOutboundMediaAccess({
      cfg: {} as CrawClawConfig,
      workspaceDir: "/tmp/explicit-workspace",
      mediaAccess: { workspaceDir: "/tmp/media-workspace" },
    });

    expect(result).toMatchObject({ workspaceDir: "/tmp/explicit-workspace" });
  });
});
