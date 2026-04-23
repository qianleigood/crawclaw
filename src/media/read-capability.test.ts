import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { resolveAgentScopedOutboundMediaAccess } from "./read-capability.js";

vi.mock("../channels/plugins/index.js", () => ({
  getChannelPlugin: () => undefined,
}));

describe("resolveAgentScopedOutboundMediaAccess", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("does not enable host reads when sender group policy denies read", () => {
    const cfg: CrawClawConfig = {
      tools: {
        allow: ["read"],
      },
      channels: {
        requestchat: {
          groups: {
            ops: {
              toolsBySender: {
                "id:attacker": {
                  deny: ["read"],
                },
              },
            },
          },
        },
      },
    };

    const result = resolveAgentScopedOutboundMediaAccess({
      cfg,
      sessionKey: "agent:main:requestchat:group:ops",
      mediaSources: ["/Users/peter/Pictures/photo.png"],
      requesterSenderId: "attacker",
    });

    expect(result.readFile).toBeUndefined();
    expect(result.localRoots).not.toContain("/Users/peter/Pictures");
  });

  it("keeps host reads enabled when sender group policy allows read", () => {
    const cfg: CrawClawConfig = {
      tools: {
        allow: ["read"],
      },
      channels: {
        requestchat: {
          groups: {
            ops: {
              toolsBySender: {
                "id:trusted-user": {
                  allow: ["read"],
                },
              },
            },
          },
        },
      },
    };

    const result = resolveAgentScopedOutboundMediaAccess({
      cfg,
      sessionKey: "agent:main:requestchat:group:ops",
      mediaSources: ["/Users/peter/Pictures/photo.png"],
      requesterSenderId: "trusted-user",
    });

    expect(result.readFile).toBeTypeOf("function");
  });

  it("keeps host reads enabled when no group policy applies", () => {
    const result = resolveAgentScopedOutboundMediaAccess({
      cfg: {
        tools: {
          allow: ["read"],
        },
      } as CrawClawConfig,
      messageProvider: "requestchat",
      requesterSenderId: "trusted-user",
    });

    expect(result.readFile).toBeTypeOf("function");
  });

  it("keeps host reads enabled for DM sender when no group context exists", () => {
    const result = resolveAgentScopedOutboundMediaAccess({
      cfg: {
        tools: {
          allow: ["read"],
        },
        channels: {
          requestchat: {
            groups: {
              ops: {
                toolsBySender: {
                  "id:dm-sender": {
                    deny: ["read"],
                  },
                },
              },
            },
          },
        },
      } as CrawClawConfig,
      messageProvider: "requestchat",
      requesterSenderId: "dm-sender",
    });

    expect(result.readFile).toBeTypeOf("function");
  });
});
