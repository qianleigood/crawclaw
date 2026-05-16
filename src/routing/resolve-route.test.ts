import { describe, expect, test, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import * as routingBindings from "./bindings.js";
import {
  clearResolveRouteCaches,
  deriveLastRoutePolicy,
  getResolveRouteCacheMeta,
  ROUTE_AGENT_LOOKUP_CACHE_DESCRIPTOR,
  ROUTE_EVALUATED_BINDINGS_CACHE_DESCRIPTOR,
  ROUTE_RESOLVED_ROUTE_CACHE_DESCRIPTOR,
  resolveAgentRoute,
  resolveInboundLastRouteSessionKey,
} from "./resolve-route.js";

type ResolvedRouteExpectation = {
  agentId: string;
  matchedBy: string;
  sessionKey?: string;
  accountId?: string;
  lastRoutePolicy?: string;
};

type CompatRoutePeerKind =
  | NonNullable<Parameters<typeof resolveAgentRoute>[0]["peer"]>["kind"]
  | "dm";

const resolveRoute = (
  params: Omit<Parameters<typeof resolveAgentRoute>[0], "cfg"> & { cfg?: CrawClawConfig },
) =>
  resolveAgentRoute({
    cfg: params.cfg ?? {},
    ...params,
  });

function expectResolvedRoute(
  route: ReturnType<typeof resolveAgentRoute>,
  expected: ResolvedRouteExpectation,
) {
  expect(route.agentId).toBe(expected.agentId);
  expect(route.matchedBy).toBe(expected.matchedBy);
  if (expected.sessionKey !== undefined) {
    expect(route.sessionKey).toBe(expected.sessionKey);
  }
  if (expected.accountId !== undefined) {
    expect(route.accountId).toBe(expected.accountId);
  }
  if (expected.lastRoutePolicy !== undefined) {
    expect(route.lastRoutePolicy).toBe(expected.lastRoutePolicy);
  }
}

function createCompatPeer(kind: CompatRoutePeerKind, id: string) {
  return { kind, id } as unknown as NonNullable<Parameters<typeof resolveAgentRoute>[0]["peer"]>;
}

describe("resolveAgentRoute", () => {
  const expectDirectRouteSessionKey = (params: {
    cfg: CrawClawConfig;
    channel: Parameters<typeof resolveAgentRoute>[0]["channel"];
    peerId: string;
    expected: string;
  }) => {
    const route = resolveRoute({
      cfg: params.cfg,
      channel: params.channel,
      accountId: null,
      peer: { kind: "direct", id: params.peerId },
    });
    expect(route.sessionKey).toBe(params.expected);
    return route;
  };

  const expectRouteResolutionCase = (params: {
    routeParams: Omit<Parameters<typeof resolveRoute>[0], "cfg"> & { cfg: CrawClawConfig };
    expected: ResolvedRouteExpectation;
  }) => {
    expectResolvedRoute(resolveRoute(params.routeParams), params.expected);
  };

  const expectInboundLastRouteSessionKeyCase = (params: {
    route: { mainSessionKey: string; lastRoutePolicy: "main" | "session" };
    sessionKey: string;
    expected: string;
  }) => {
    expect(
      resolveInboundLastRouteSessionKey({
        route: params.route,
        sessionKey: params.sessionKey,
      }),
    ).toBe(params.expected);
  };

  const expectDerivedLastRoutePolicyCase = (params: {
    sessionKey: string;
    mainSessionKey: string;
    expected: "main" | "session";
  }) => {
    expect(
      deriveLastRoutePolicy({
        sessionKey: params.sessionKey,
        mainSessionKey: params.mainSessionKey,
      }),
    ).toBe(params.expected);
  };

  test("defaults to main/default when no bindings exist", () => {
    const cfg: CrawClawConfig = {};
    const route = resolveAgentRoute({
      cfg,
      channel: "weixin",
      accountId: null,
      peer: { kind: "direct", id: "+15551234567" },
    });
    expectResolvedRoute(route, {
      agentId: "main",
      accountId: "default",
      sessionKey: "agent:main:main",
      lastRoutePolicy: "main",
      matchedBy: "default",
    });
  });

  test.each([
    { dmScope: "per-peer" as const, expected: "agent:main:direct:+15551234567" },
    {
      dmScope: "per-channel-peer" as const,
      expected: "agent:main:weixin:direct:+15551234567",
    },
  ])("dmScope=%s controls direct-message session key isolation", ({ dmScope, expected }) => {
    const cfg: CrawClawConfig = {
      session: { dmScope },
    };
    const route = expectDirectRouteSessionKey({
      cfg,
      channel: "weixin",
      peerId: "+15551234567",
      expected,
    });
    expectResolvedRoute(route, {
      agentId: "main",
      matchedBy: "default",
      lastRoutePolicy: "session",
    });
  });

  test.each([
    {
      name: "collapses inbound last-route session keys to main when policy is main",
      route: {
        mainSessionKey: "agent:main:main",
        lastRoutePolicy: "main" as const,
      },
      sessionKey: "agent:main:qqbot:direct:user-1",
      expected: "agent:main:main",
    },
    {
      name: "preserves inbound last-route session keys when policy is session",
      route: {
        mainSessionKey: "agent:main:main",
        lastRoutePolicy: "session" as const,
      },
      sessionKey: "agent:main:feishu:atlas:direct:123",
      expected: "agent:main:feishu:atlas:direct:123",
    },
  ] as const)("$name", ({ route, sessionKey, expected }) => {
    expectInboundLastRouteSessionKeyCase({ route, sessionKey, expected });
  });

  test.each([
    {
      name: "classifies the main session route as main",
      sessionKey: "agent:main:main",
      mainSessionKey: "agent:main:main",
      expected: "main" as const,
    },
    {
      name: "keeps non-main session routes scoped to session",
      sessionKey: "agent:main:feishu:direct:123",
      mainSessionKey: "agent:main:main",
      expected: "session" as const,
    },
  ] as const)("$name", ({ sessionKey, mainSessionKey, expected }) => {
    expectDerivedLastRoutePolicyCase({ sessionKey, mainSessionKey, expected });
  });

  test.each([
    {
      dmScope: "per-peer" as const,
      channel: "feishu" as const,
      peerId: "111111111",
      expected: "agent:main:direct:alice",
    },
    {
      dmScope: "per-channel-peer" as const,
      channel: "qqbot" as const,
      peerId: "222222222222222222",
      expected: "agent:main:qqbot:direct:alice",
    },
  ])(
    "identityLinks applies to direct-message scopes: $channel $dmScope",
    ({ dmScope, channel, peerId, expected }) => {
      const cfg: CrawClawConfig = {
        session: {
          dmScope,
          identityLinks: {
            alice: ["feishu:111111111", "qqbot:222222222222222222"],
          },
        },
      };
      expectDirectRouteSessionKey({
        cfg,
        channel,
        peerId,
        expected,
      });
    },
  );

  test.each([
    {
      name: "peer binding wins over account binding",
      routeParams: {
        cfg: {
          bindings: [
            {
              agentId: "a",
              match: {
                channel: "weixin",
                accountId: "biz",
                peer: { kind: "direct", id: "+1000" },
              },
            },
            {
              agentId: "b",
              match: { channel: "weixin", accountId: "biz" },
            },
          ],
        } satisfies CrawClawConfig,
        channel: "weixin" as const,
        accountId: "biz",
        peer: { kind: "direct" as const, id: "+1000" },
      },
      expected: {
        agentId: "a",
        sessionKey: "agent:a:main",
        matchedBy: "binding.peer",
      },
    },
    {
      name: "qqbot channel peer binding wins over guild binding",
      routeParams: {
        cfg: {
          bindings: [
            {
              agentId: "chan",
              match: {
                channel: "qqbot",
                accountId: "default",
                peer: { kind: "channel", id: "c1" },
              },
            },
            {
              agentId: "guild",
              match: {
                channel: "qqbot",
                accountId: "default",
                guildId: "g1",
              },
            },
          ],
        } satisfies CrawClawConfig,
        channel: "qqbot" as const,
        accountId: "default",
        guildId: "g1",
        peer: { kind: "channel" as const, id: "c1" },
      },
      expected: {
        agentId: "chan",
        sessionKey: "agent:chan:qqbot:channel:c1",
        matchedBy: "binding.peer",
      },
    },
    {
      name: "guild binding wins over account binding when peer is not bound",
      routeParams: {
        cfg: {
          bindings: [
            {
              agentId: "guild",
              match: {
                channel: "qqbot",
                accountId: "default",
                guildId: "g1",
              },
            },
            {
              agentId: "acct",
              match: { channel: "qqbot", accountId: "default" },
            },
          ],
        } satisfies CrawClawConfig,
        channel: "qqbot" as const,
        accountId: "default",
        guildId: "g1",
        peer: { kind: "channel" as const, id: "c1" },
      },
      expected: {
        agentId: "guild",
        matchedBy: "binding.guild",
      },
    },
  ] as const)("$name", ({ routeParams, expected }) => {
    expectRouteResolutionCase({ routeParams, expected });
  });

  test("coerces numeric peer ids to stable session keys", () => {
    const cfg: CrawClawConfig = {};
    const route = resolveAgentRoute({
      cfg,
      channel: "qqbot",
      accountId: "default",
      peer: { kind: "channel", id: 1468834856187203680n as unknown as string },
    });
    expect(route.sessionKey).toBe("agent:main:qqbot:channel:1468834856187203680");
  });

  test.each([
    {
      name: "peer+guild binding does not act as guild-wide fallback when peer mismatches (#14752)",
      routeParams: {
        cfg: {
          bindings: [
            {
              agentId: "olga",
              match: {
                channel: "qqbot",
                peer: { kind: "channel", id: "CHANNEL_A" },
                guildId: "GUILD_1",
              },
            },
            {
              agentId: "main",
              match: {
                channel: "qqbot",
                guildId: "GUILD_1",
              },
            },
          ],
        } satisfies CrawClawConfig,
        channel: "qqbot" as const,
        guildId: "GUILD_1",
        peer: { kind: "channel" as const, id: "CHANNEL_B" },
      },
      expected: {
        agentId: "main",
        matchedBy: "binding.guild",
      },
    },
    {
      name: "peer+guild binding requires guild match even when peer matches",
      routeParams: {
        cfg: {
          bindings: [
            {
              agentId: "wrongguild",
              match: {
                channel: "qqbot",
                peer: { kind: "channel", id: "c1" },
                guildId: "g1",
              },
            },
            {
              agentId: "rightguild",
              match: {
                channel: "qqbot",
                guildId: "g2",
              },
            },
          ],
        } satisfies CrawClawConfig,
        channel: "qqbot" as const,
        guildId: "g2",
        peer: { kind: "channel" as const, id: "c1" },
      },
      expected: {
        agentId: "rightguild",
        matchedBy: "binding.guild",
      },
    },
    {
      name: "peer+team binding does not act as team-wide fallback when peer mismatches",
      routeParams: {
        cfg: {
          bindings: [
            {
              agentId: "roomonly",
              match: {
                channel: "ddingtalk",
                peer: { kind: "channel", id: "C_A" },
                teamId: "T1",
              },
            },
            {
              agentId: "teamwide",
              match: {
                channel: "ddingtalk",
                teamId: "T1",
              },
            },
          ],
        } satisfies CrawClawConfig,
        channel: "ddingtalk" as const,
        teamId: "T1",
        peer: { kind: "channel" as const, id: "C_B" },
      },
      expected: {
        agentId: "teamwide",
        matchedBy: "binding.team",
      },
    },
    {
      name: "peer+team binding requires team match even when peer matches",
      routeParams: {
        cfg: {
          bindings: [
            {
              agentId: "wrongteam",
              match: {
                channel: "ddingtalk",
                peer: { kind: "channel", id: "C1" },
                teamId: "T1",
              },
            },
            {
              agentId: "rightteam",
              match: {
                channel: "ddingtalk",
                teamId: "T2",
              },
            },
          ],
        } satisfies CrawClawConfig,
        channel: "ddingtalk" as const,
        teamId: "T2",
        peer: { kind: "channel" as const, id: "C1" },
      },
      expected: {
        agentId: "rightteam",
        matchedBy: "binding.team",
      },
    },
  ] as const)("$name", ({ routeParams, expected }) => {
    expectRouteResolutionCase({ routeParams, expected });
  });

  test("missing accountId in binding matches default account only", () => {
    const cfg: CrawClawConfig = {
      bindings: [{ agentId: "defaultAcct", match: { channel: "weixin" } }],
    };

    expectResolvedRoute(
      resolveRoute({
        cfg,
        channel: "weixin",
        accountId: undefined,
        peer: { kind: "direct", id: "+1000" },
      }),
      {
        agentId: "defaultacct",
        matchedBy: "binding.account",
      },
    );

    expectResolvedRoute(
      resolveRoute({
        cfg,
        channel: "weixin",
        accountId: "biz",
        peer: { kind: "direct", id: "+1000" },
      }),
      {
        agentId: "main",
        matchedBy: "default",
      },
    );
  });

  test.each([
    {
      name: "accountId=* matches any account as a channel fallback",
      cfg: {
        bindings: [
          {
            agentId: "any",
            match: { channel: "weixin", accountId: "*" },
          },
        ],
      } satisfies CrawClawConfig,
      channel: "weixin" as const,
      accountId: "biz",
      peer: { kind: "direct" as const, id: "+1000" },
      expected: {
        agentId: "any",
        matchedBy: "binding.channel",
      },
    },
    {
      name: "binding accountId matching is canonicalized",
      cfg: {
        bindings: [{ agentId: "biz", match: { channel: "qqbot", accountId: "BIZ" } }],
      } satisfies CrawClawConfig,
      channel: "qqbot" as const,
      accountId: " biz ",
      peer: { kind: "direct" as const, id: "u-1" },
      expected: {
        agentId: "biz",
        matchedBy: "binding.account",
        accountId: "biz",
      },
    },
    {
      name: "defaultAgentId is used when no binding matches",
      cfg: {
        agents: {
          list: [{ id: "home", default: true, workspace: "~/crawclaw-home" }],
        },
      } satisfies CrawClawConfig,
      channel: "weixin" as const,
      accountId: "biz",
      peer: { kind: "direct" as const, id: "+1000" },
      expected: {
        agentId: "home",
        matchedBy: "default",
        sessionKey: "agent:home:main",
      },
    },
  ] as const)("$name", ({ cfg, channel, accountId, peer, expected }) => {
    expectResolvedRoute(
      resolveRoute({
        cfg,
        channel,
        accountId,
        peer,
      }),
      expected,
    );
  });
});

describe("resolve-route cache governance", () => {
  test("reports route cache sizes and supports explicit invalidation", () => {
    const cfg: CrawClawConfig = {
      bindings: [
        {
          agentId: "router",
          match: {
            channel: "feishu",
            peer: { kind: "direct", id: "user-1" },
          },
        },
      ],
      agents: {
        list: [{ id: "router" }],
      },
    };

    expect(getResolveRouteCacheMeta(cfg)).toMatchObject({
      agentLookupEntries: 0,
      evaluatedBindingsByChannel: 0,
      evaluatedBindingsByChannelAccount: 0,
      evaluatedBindingsByChannelAccountIndex: 0,
      resolvedRouteEntries: 0,
    });

    resolveAgentRoute({
      cfg,
      channel: "feishu",
      accountId: "default",
      peer: { kind: "direct", id: "user-1" },
    });

    expect(getResolveRouteCacheMeta(cfg)).toMatchObject({
      agentLookupEntries: 1,
      evaluatedBindingsByChannel: 1,
      evaluatedBindingsByChannelAccount: 1,
      evaluatedBindingsByChannelAccountIndex: 1,
      resolvedRouteEntries: 1,
    });

    clearResolveRouteCaches(cfg);
    expect(getResolveRouteCacheMeta(cfg)).toMatchObject({
      agentLookupEntries: 0,
      evaluatedBindingsByChannel: 0,
      evaluatedBindingsByChannelAccount: 0,
      evaluatedBindingsByChannelAccountIndex: 0,
      resolvedRouteEntries: 0,
    });
  });

  test("publishes explicit governance descriptors for routing caches", () => {
    expect(ROUTE_AGENT_LOOKUP_CACHE_DESCRIPTOR.category).toBe("plugin_routing_control_plane");
    expect(ROUTE_EVALUATED_BINDINGS_CACHE_DESCRIPTOR.owner).toContain("resolve-route");
    expect(ROUTE_RESOLVED_ROUTE_CACHE_DESCRIPTOR.observability).toContain(
      "getResolveRouteCacheMeta(cfg).resolvedRouteEntries",
    );
  });

  test("refreshes cached routes when bindings are mutated in place", () => {
    const cfg: CrawClawConfig = {
      bindings: [],
      agents: {
        list: [{ id: "main" }, { id: "special" }],
      },
    };
    const input = {
      cfg,
      channel: "feishu" as const,
      accountId: "default",
      peer: { kind: "direct" as const, id: "user-1" },
    };

    expect(resolveAgentRoute(input).agentId).toBe("main");
    cfg.bindings?.push({
      agentId: "special",
      match: {
        channel: "feishu",
        peer: { kind: "direct", id: "user-1" },
      },
    });

    expect(resolveAgentRoute(input).agentId).toBe("special");
  });
});

test.each([
  {
    name: "isolates DM sessions per account, channel and sender",
    accountId: "tasks",
    expected: "agent:main:feishu:tasks:direct:7550356539",
  },
  {
    name: "uses default accountId when not provided",
    accountId: null,
    expected: "agent:main:feishu:default:direct:7550356539",
  },
] as const)("dmScope=per-account-channel-peer $name", ({ accountId, expected }) => {
  const route = resolveAgentRoute({
    cfg: {
      session: { dmScope: "per-account-channel-peer" },
    },
    channel: "feishu",
    accountId,
    peer: { kind: "direct", id: "7550356539" },
  });
  expect(route.sessionKey).toBe(expected);
});

describe("parentPeer binding inheritance (thread support)", () => {
  const threadPeer = { kind: "channel" as const, id: "thread-456" };
  const defaultParentPeer = { kind: "channel" as const, id: "parent-channel-123" };

  function makeQQBotPeerBinding(agentId: string, peerId: string) {
    return {
      agentId,
      match: {
        channel: "qqbot" as const,
        peer: { kind: "channel" as const, id: peerId },
      },
    };
  }

  function makeQQBotGuildBinding(agentId: string, guildId: string) {
    return {
      agentId,
      match: {
        channel: "qqbot" as const,
        guildId,
      },
    };
  }

  function resolveQQBotThreadRoute(params: {
    cfg: CrawClawConfig;
    parentPeer?: { kind: "channel"; id: string } | null;
    guildId?: string;
  }) {
    const parentPeer = "parentPeer" in params ? params.parentPeer : defaultParentPeer;
    return resolveAgentRoute({
      cfg: params.cfg,
      channel: "qqbot",
      peer: threadPeer,
      parentPeer,
      guildId: params.guildId,
    });
  }

  function expectQQBotThreadRoute(params: {
    cfg: CrawClawConfig;
    parentPeer?: { kind: "channel"; id: string } | null;
    guildId?: string;
    expectedAgentId: string;
    expectedMatchedBy: string;
  }) {
    const route = resolveQQBotThreadRoute(params);
    expectResolvedRoute(route, {
      agentId: params.expectedAgentId,
      matchedBy: params.expectedMatchedBy,
    });
  }

  test("thread inherits binding from parent channel when no direct match", () => {
    expectQQBotThreadRoute({
      cfg: {
        bindings: [makeQQBotPeerBinding("adecco", defaultParentPeer.id)],
      },
      expectedAgentId: "adecco",
      expectedMatchedBy: "binding.peer.parent",
    });
  });

  test("direct peer binding wins over parent peer binding", () => {
    expectQQBotThreadRoute({
      cfg: {
        bindings: [
          makeQQBotPeerBinding("thread-agent", threadPeer.id),
          makeQQBotPeerBinding("parent-agent", defaultParentPeer.id),
        ],
      },
      expectedAgentId: "thread-agent",
      expectedMatchedBy: "binding.peer",
    });
  });

  test("parent peer binding wins over guild binding", () => {
    expectQQBotThreadRoute({
      cfg: {
        bindings: [
          makeQQBotPeerBinding("parent-agent", defaultParentPeer.id),
          makeQQBotGuildBinding("guild-agent", "guild-789"),
        ],
      },
      guildId: "guild-789",
      expectedAgentId: "parent-agent",
      expectedMatchedBy: "binding.peer.parent",
    });
  });

  test.each([
    {
      name: "falls back to guild binding when no parent peer match",
      cfg: {
        bindings: [
          makeQQBotPeerBinding("other-parent-agent", "other-parent-999"),
          makeQQBotGuildBinding("guild-agent", "guild-789"),
        ],
      } satisfies CrawClawConfig,
      guildId: "guild-789",
      expectedAgentId: "guild-agent",
      expectedMatchedBy: "binding.guild",
    },
    {
      name: "parentPeer with empty id is ignored",
      cfg: {
        bindings: [makeQQBotPeerBinding("parent-agent", defaultParentPeer.id)],
      } satisfies CrawClawConfig,
      parentPeer: { kind: "channel" as const, id: "" },
      expectedAgentId: "main",
      expectedMatchedBy: "default",
    },
    {
      name: "null parentPeer is handled gracefully",
      cfg: {
        bindings: [makeQQBotPeerBinding("parent-agent", defaultParentPeer.id)],
      } satisfies CrawClawConfig,
      parentPeer: null,
      expectedAgentId: "main",
      expectedMatchedBy: "default",
    },
  ])("$name", (testCase) => {
    expectQQBotThreadRoute(testCase);
  });
});

describe("removed compatibility: peer.kind dm no longer aliases direct", () => {
  test.each([
    {
      name: "legacy dm in config matches runtime direct peer",
      bindingPeerKind: "dm" as const satisfies CompatRoutePeerKind,
      runtimePeerKind: "direct" as const satisfies CompatRoutePeerKind,
    },
    {
      name: "runtime dm peer.kind matches config direct binding (#22730)",
      bindingPeerKind: "direct" as const satisfies CompatRoutePeerKind,
      runtimePeerKind: "dm" as const satisfies CompatRoutePeerKind,
    },
  ])("$name", ({ bindingPeerKind, runtimePeerKind }) => {
    const route = resolveAgentRoute({
      cfg: {
        bindings: [
          {
            agentId: "alex",
            match: {
              channel: "weixin",
              peer: createCompatPeer(bindingPeerKind, "+15551234567"),
            },
          },
        ],
      },
      channel: "weixin",
      accountId: null,
      peer: createCompatPeer(runtimePeerKind, "+15551234567"),
    });
    expectResolvedRoute(route, {
      agentId: "main",
      matchedBy: "default",
    });
  });
});

describe("backward compatibility: peer.kind group ↔ channel", () => {
  test.each([
    {
      name: "config group binding matches runtime channel scope",
      agentId: "ddingtalk-group-agent",
      bindingPeerKind: "group" as const satisfies CompatRoutePeerKind,
      runtimePeerKind: "channel" as const satisfies CompatRoutePeerKind,
      expectedAgentId: "ddingtalk-group-agent",
      expectedMatchedBy: "binding.peer",
    },
    {
      name: "config channel binding matches runtime group scope",
      agentId: "ddingtalk-channel-agent",
      bindingPeerKind: "channel" as const satisfies CompatRoutePeerKind,
      runtimePeerKind: "group" as const satisfies CompatRoutePeerKind,
      expectedAgentId: "ddingtalk-channel-agent",
      expectedMatchedBy: "binding.peer",
    },
    {
      name: "group/channel compatibility does not match direct peer kind",
      agentId: "group-only-agent",
      bindingPeerKind: "group" as const satisfies CompatRoutePeerKind,
      runtimePeerKind: "direct" as const satisfies CompatRoutePeerKind,
      expectedAgentId: "main",
      expectedMatchedBy: "default",
    },
  ])(
    "$name",
    ({ agentId, bindingPeerKind, runtimePeerKind, expectedAgentId, expectedMatchedBy }) => {
      const route = resolveAgentRoute({
        cfg: {
          bindings: [
            {
              agentId,
              match: {
                channel: "ddingtalk",
                peer: createCompatPeer(bindingPeerKind, "C123456"),
              },
            },
          ],
        },
        channel: "ddingtalk",
        accountId: null,
        peer: createCompatPeer(runtimePeerKind, "C123456"),
      });
      expectResolvedRoute(route, {
        agentId: expectedAgentId,
        matchedBy: expectedMatchedBy,
      });
    },
  );
});

describe("role-based agent routing", () => {
  type QQBotBinding = NonNullable<CrawClawConfig["bindings"]>[number];

  function makeQQBotRoleBinding(
    agentId: string,
    params: {
      roles?: readonly string[];
      peerId?: string;
      includeGuildId?: boolean;
    } = {},
  ): QQBotBinding {
    return {
      agentId,
      match: {
        channel: "qqbot",
        ...(params.includeGuildId === false ? {} : { guildId: "g1" }),
        ...(params.roles !== undefined ? { roles: [...params.roles] } : {}),
        ...(params.peerId ? { peer: { kind: "channel", id: params.peerId } } : {}),
      },
    };
  }

  function expectQQBotRoleRoute(params: {
    bindings: readonly QQBotBinding[];
    memberRoleIds?: readonly string[];
    peerId?: string;
    parentPeerId?: string;
    expectedAgentId: string;
    expectedMatchedBy: string;
  }) {
    const route = resolveRoute({
      cfg: { bindings: [...params.bindings] },
      channel: "qqbot",
      guildId: "g1",
      ...(params.memberRoleIds ? { memberRoleIds: [...params.memberRoleIds] } : {}),
      peer: { kind: "channel", id: params.peerId ?? "c1" },
      ...(params.parentPeerId
        ? {
            parentPeer: { kind: "channel", id: params.parentPeerId },
          }
        : {}),
    });
    expect(route.agentId).toBe(params.expectedAgentId);
    expect(route.matchedBy).toBe(params.expectedMatchedBy);
  }

  test.each([
    {
      name: "guild+roles binding matches when member has matching role",
      bindings: [makeQQBotRoleBinding("opus", { roles: ["r1"] })],
      memberRoleIds: ["r1"],
      expectedAgentId: "opus",
      expectedMatchedBy: "binding.guild+roles",
    },
    {
      name: "guild+roles binding skipped when no matching role",
      bindings: [makeQQBotRoleBinding("opus", { roles: ["r1"] })],
      memberRoleIds: ["r2"],
      expectedAgentId: "main",
      expectedMatchedBy: "default",
    },
    {
      name: "guild+roles is more specific than guild-only",
      bindings: [makeQQBotRoleBinding("opus", { roles: ["r1"] }), makeQQBotRoleBinding("sonnet")],
      memberRoleIds: ["r1"],
      expectedAgentId: "opus",
      expectedMatchedBy: "binding.guild+roles",
    },
    {
      name: "peer binding still beats guild+roles",
      bindings: [
        makeQQBotRoleBinding("peer-agent", { peerId: "c1", includeGuildId: false }),
        makeQQBotRoleBinding("roles-agent", { roles: ["r1"] }),
      ],
      memberRoleIds: ["r1"],
      expectedAgentId: "peer-agent",
      expectedMatchedBy: "binding.peer",
    },
    {
      name: "parent peer binding still beats guild+roles",
      bindings: [
        makeQQBotRoleBinding("parent-agent", {
          peerId: "parent-1",
          includeGuildId: false,
        }),
        makeQQBotRoleBinding("roles-agent", { roles: ["r1"] }),
      ],
      memberRoleIds: ["r1"],
      peerId: "thread-1",
      parentPeerId: "parent-1",
      expectedAgentId: "parent-agent",
      expectedMatchedBy: "binding.peer.parent",
    },
    {
      name: "no memberRoleIds means guild+roles doesn't match",
      bindings: [makeQQBotRoleBinding("opus", { roles: ["r1"] })],
      expectedAgentId: "main",
      expectedMatchedBy: "default",
    },
    {
      name: "first matching binding wins with multiple role bindings",
      bindings: [
        makeQQBotRoleBinding("opus", { roles: ["r1"] }),
        makeQQBotRoleBinding("sonnet", { roles: ["r2"] }),
      ],
      memberRoleIds: ["r1", "r2"],
      expectedAgentId: "opus",
      expectedMatchedBy: "binding.guild+roles",
    },
    {
      name: "empty roles array treated as no role restriction",
      bindings: [makeQQBotRoleBinding("opus", { roles: [] })],
      memberRoleIds: ["r1"],
      expectedAgentId: "opus",
      expectedMatchedBy: "binding.guild",
    },
    {
      name: "guild+roles binding does not match as guild-only when roles do not match",
      bindings: [makeQQBotRoleBinding("opus", { roles: ["admin"] })],
      memberRoleIds: ["regular"],
      expectedAgentId: "main",
      expectedMatchedBy: "default",
    },
    {
      name: "peer+guild+roles binding does not act as guild+roles fallback when peer mismatches",
      bindings: [
        makeQQBotRoleBinding("peer-roles", { peerId: "c-target", roles: ["r1"] }),
        makeQQBotRoleBinding("guild-roles", { roles: ["r1"] }),
      ],
      memberRoleIds: ["r1"],
      peerId: "c-other",
      expectedAgentId: "guild-roles",
      expectedMatchedBy: "binding.guild+roles",
    },
  ] as const)("$name", (testCase) => {
    expectQQBotRoleRoute(testCase);
  });
});

describe("wildcard peer bindings (peer.id=*)", () => {
  test("peer.id=* matches any direct peer and routes to the bound agent", () => {
    const cfg: CrawClawConfig = {
      agents: { list: [{ id: "second-ana" }] },
      bindings: [
        {
          agentId: "second-ana",
          match: {
            channel: "feishu",
            accountId: "second-ana",
            peer: { kind: "direct", id: "*" },
          },
        },
      ],
    };
    const route = resolveAgentRoute({
      cfg,
      channel: "feishu",
      accountId: "second-ana",
      peer: { kind: "direct", id: "12345678" },
    });
    expect(route.agentId).toBe("second-ana");
    expect(route.sessionKey).toContain("agent:second-ana:");
    expect(route.matchedBy).toBe("binding.peer.wildcard");
  });

  test("peer.id=* does not match group peers when kind is direct", () => {
    const cfg: CrawClawConfig = {
      agents: { list: [{ id: "main", default: true }, { id: "dm-only" }] },
      bindings: [
        {
          agentId: "dm-only",
          match: {
            channel: "feishu",
            accountId: "bot1",
            peer: { kind: "direct", id: "*" },
          },
        },
      ],
    };
    const route = resolveAgentRoute({
      cfg,
      channel: "feishu",
      accountId: "bot1",
      peer: { kind: "group", id: "group-999" },
    });
    expect(route.agentId).toBe("main");
    expect(route.matchedBy).toBe("default");
  });

  test("exact peer binding wins over wildcard peer binding", () => {
    const cfg: CrawClawConfig = {
      agents: { list: [{ id: "exact" }, { id: "wild" }] },
      bindings: [
        {
          agentId: "wild",
          match: {
            channel: "weixin",
            accountId: "biz",
            peer: { kind: "direct", id: "*" },
          },
        },
        {
          agentId: "exact",
          match: {
            channel: "weixin",
            accountId: "biz",
            peer: { kind: "direct", id: "+1000" },
          },
        },
      ],
    };
    const route = resolveAgentRoute({
      cfg,
      channel: "weixin",
      accountId: "biz",
      peer: { kind: "direct", id: "+1000" },
    });
    expect(route.agentId).toBe("exact");
    expect(route.matchedBy).toBe("binding.peer");
  });

  test("wildcard peer binding wins over default fallback for unmatched peers", () => {
    const cfg: CrawClawConfig = {
      agents: { list: [{ id: "exact" }, { id: "wild" }] },
      bindings: [
        {
          agentId: "wild",
          match: {
            channel: "weixin",
            accountId: "biz",
            peer: { kind: "direct", id: "*" },
          },
        },
        {
          agentId: "exact",
          match: {
            channel: "weixin",
            accountId: "biz",
            peer: { kind: "direct", id: "+1000" },
          },
        },
      ],
    };
    const route = resolveAgentRoute({
      cfg,
      channel: "weixin",
      accountId: "biz",
      peer: { kind: "direct", id: "+9999" },
    });
    expect(route.agentId).toBe("wild");
    expect(route.matchedBy).toBe("binding.peer.wildcard");
  });

  test("group wildcard peer matches any group peer", () => {
    const cfg: CrawClawConfig = {
      agents: { list: [{ id: "grp" }] },
      bindings: [
        {
          agentId: "grp",
          match: {
            channel: "qqbot",
            accountId: "default",
            peer: { kind: "group", id: "*" },
          },
        },
      ],
    };
    const route = resolveAgentRoute({
      cfg,
      channel: "qqbot",
      accountId: "default",
      peer: { kind: "group", id: "g-42" },
    });
    expect(route.agentId).toBe("grp");
    expect(route.matchedBy).toBe("binding.peer.wildcard");
  });
});

describe("binding evaluation cache scalability", () => {
  test("does not rescan full bindings after channel/account cache rollover (#36915)", () => {
    const bindingCount = 2_205;
    const cfg: CrawClawConfig = {
      bindings: Array.from({ length: bindingCount }, (_, idx) => ({
        agentId: `agent-${idx}`,
        match: {
          channel: "dingtalk",
          accountId: `acct-${idx}`,
          peer: { kind: "direct", id: `user-${idx}` },
        },
      })),
    };
    const listBindingsSpy = vi.spyOn(routingBindings, "listBindings");
    try {
      for (let idx = 0; idx < bindingCount; idx += 1) {
        const route = resolveAgentRoute({
          cfg,
          channel: "dingtalk",
          accountId: `acct-${idx}`,
          peer: { kind: "direct", id: `user-${idx}` },
        });
        expect(route.agentId).toBe(`agent-${idx}`);
        expect(route.matchedBy).toBe("binding.peer");
      }

      const repeated = resolveAgentRoute({
        cfg,
        channel: "dingtalk",
        accountId: "acct-0",
        peer: { kind: "direct", id: "user-0" },
      });
      expect(repeated.agentId).toBe("agent-0");
      expect(listBindingsSpy).toHaveBeenCalledTimes(1);
    } finally {
      listBindingsSpy.mockRestore();
    }
  });
});
