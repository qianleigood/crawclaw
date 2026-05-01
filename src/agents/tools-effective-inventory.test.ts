import { describe, expect, it, vi } from "vitest";

async function loadHarness(options?: {
  tools?: Array<{ name: string; label?: string; description?: string; displaySummary?: string }>;
  createToolsMock?: ReturnType<typeof vi.fn>;
  pluginMeta?: Record<string, { pluginId: string } | undefined>;
  channelMeta?: Record<string, { channelId: string } | undefined>;
  effectivePolicy?: { profile?: string; providerProfile?: string };
  resolvedModelCompat?: Record<string, unknown>;
}) {
  vi.resetModules();
  vi.doMock("./agent-scope.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./agent-scope.js")>();
    return {
      ...actual,
      resolveSessionAgentId: () => "main",
      resolveAgentWorkspaceDir: () => "/tmp/workspace-main",
      resolveAgentDir: () => "/tmp/agents/main/agent",
    };
  });
  const createToolsMock =
    options?.createToolsMock ??
    vi.fn(
      () =>
        options?.tools ?? [
          { name: "exec", label: "Exec", description: "Run shell commands" },
          { name: "docs_lookup", label: "Docs Lookup", description: "Search docs" },
        ],
    );
  vi.doMock("./pi-tools.js", () => ({
    createCrawClawCodingTools: createToolsMock,
  }));
  vi.doMock("./pi-embedded-runner/model.js", () => ({
    resolveModel: vi.fn(() => ({
      model: options?.resolvedModelCompat ? { compat: options.resolvedModelCompat } : undefined,
      authStorage: {} as never,
      modelRegistry: {} as never,
    })),
  }));
  vi.doMock("../plugins/tools.js", () => ({
    getPluginToolMeta: (tool: { name: string }) => options?.pluginMeta?.[tool.name],
  }));
  vi.doMock("./channel-tools.js", () => ({
    getChannelAgentToolMeta: (tool: { name: string }) => options?.channelMeta?.[tool.name],
  }));
  vi.doMock("./pi-tools.policy.js", () => ({
    resolveEffectiveToolPolicy: () => options?.effectivePolicy ?? {},
  }));
  vi.doMock("../infra/exec-approvals.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../infra/exec-approvals.js")>();
    return {
      ...actual,
      loadExecApprovals: () => ({ version: 1 }),
    };
  });
  return await import("./tools-effective-inventory.js");
}

describe("resolveEffectiveToolInventory", () => {
  it("groups core, plugin, and channel tools from the effective runtime set", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        { name: "exec", label: "Exec", description: "Run shell commands" },
        { name: "docs_lookup", label: "Docs Lookup", description: "Search docs" },
        { name: "message_actions", label: "Message Actions", description: "Act on messages" },
      ],
      pluginMeta: { docs_lookup: { pluginId: "docs" } },
      channelMeta: { message_actions: { channelId: "telegram" } },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result).toMatchObject({
      agentId: "main",
      profile: "full",
      groups: [
        {
          id: "core",
          label: "Built-in tools",
          source: "core",
          tools: [
            {
              id: "exec",
              label: "Exec",
              description: "Run shell commands",
              rawDescription: "Run shell commands",
              source: "core",
            },
          ],
        },
        {
          id: "plugin",
          label: "Connected tools",
          source: "plugin",
          tools: [
            {
              id: "docs_lookup",
              label: "Docs Lookup",
              description: "Search docs",
              rawDescription: "Search docs",
              source: "plugin",
              pluginId: "docs",
            },
          ],
        },
        {
          id: "channel",
          label: "Channel tools",
          source: "channel",
          tools: [
            {
              id: "message_actions",
              label: "Message Actions",
              description: "Act on messages",
              rawDescription: "Act on messages",
              source: "channel",
              channelId: "telegram",
            },
          ],
        },
      ],
    });
  });

  it("disambiguates duplicate labels with source ids", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        { name: "docs_lookup", label: "Lookup", description: "Search docs" },
        { name: "jira_lookup", label: "Lookup", description: "Search Jira" },
      ],
      pluginMeta: {
        docs_lookup: { pluginId: "docs" },
        jira_lookup: { pluginId: "jira" },
      },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });
    const labels = result.groups.flatMap((group) => group.tools.map((tool) => tool.label));

    expect(labels).toEqual(["Lookup (docs)", "Lookup (jira)"]);
  });

  it("prefers displaySummary over raw description", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        {
          name: "cron",
          label: "Cron",
          displaySummary: "Schedule and manage cron jobs.",
          description: "Long raw description\n\nACTIONS:\n- status",
        },
      ],
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.groups[0]?.tools[0]).toEqual({
      id: "cron",
      label: "Cron",
      description: "Schedule and manage cron jobs.",
      rawDescription: "Long raw description\n\nACTIONS:\n- status",
      source: "core",
      lifecycle: "owner_restricted",
      gatedBy: ["owner"],
      visibilityReason: "visible after owner gates",
    });
  });

  it("reports lifecycle and gate metadata for effective tools", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        { name: "browser", label: "Browser", description: "Control browser" },
        { name: "docs_lookup", label: "Docs Lookup", description: "Search docs" },
      ],
      pluginMeta: { docs_lookup: { pluginId: "docs" } },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });
    const entries = result.groups.flatMap((group) => group.tools);

    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser",
          lifecycle: "runtime_conditional",
          gatedBy: ["runtime", "profile"],
        }),
        expect.objectContaining({
          id: "docs_lookup",
          lifecycle: "runtime_conditional",
          gatedBy: ["runtime", "profile"],
          pluginId: "docs",
        }),
      ]),
    );
  });

  it("falls back to a sanitized summary for multi-line raw descriptions", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [
        {
          name: "cron",
          label: "Cron",
          description:
            "Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events.\n\nACTIONS:\n- status: Check cron scheduler status\nJOB SCHEMA:\n{ ... }",
        },
      ],
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.groups[0]?.tools[0]?.description).toBe(
      "Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events.",
    );
    expect(result.groups[0]?.tools[0]?.rawDescription).toContain("ACTIONS:");
  });

  it("includes the resolved tool profile", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [{ name: "exec", label: "Exec", description: "Run shell commands" }],
      effectivePolicy: { profile: "minimal", providerProfile: "coding" },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.profile).toBe("coding");
  });

  it("passes resolved model compat into effective tool creation", async () => {
    const createToolsMock = vi.fn(() => [
      { name: "exec", label: "Exec", description: "Run shell commands" },
    ]);
    const { resolveEffectiveToolInventory } = await loadHarness({
      createToolsMock,
      resolvedModelCompat: { supportsTools: true, nativeWebSearchTool: true },
    });

    resolveEffectiveToolInventory({
      cfg: {},
      agentDir: "/tmp/agents/main/agent",
      modelProvider: "xai",
      modelId: "grok-test",
    });

    expect(createToolsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        allowGatewaySubagentBinding: true,
        modelCompat: { supportsTools: true, nativeWebSearchTool: true },
      }),
    );
  });

  it("reports core tools unavailable because of the active profile", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [{ name: "session_status", label: "Session Status", description: "Session status" }],
      effectivePolicy: { profile: "minimal" },
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.unavailableTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "exec",
          source: "core",
          reason: "not included in tools.profile (minimal)",
        }),
      ]),
    );
  });

  it("surfaces tool policy diagnostics collected during tool creation", async () => {
    const warning =
      "tools: tools.allow allowlist contains unknown entries (wat). These entries won't match any tool unless the plugin is enabled.";
    const createToolsMock = vi.fn((options?: { toolPolicyDiagnostics?: string[] }) => {
      options?.toolPolicyDiagnostics?.push(warning);
      return [{ name: "exec", label: "Exec", description: "Run shell commands" }];
    });
    const { resolveEffectiveToolInventory } = await loadHarness({ createToolsMock });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([{ level: "warning", message: warning }]),
    );
  });

  it("surfaces risky no-approval host exec diagnostics", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [{ name: "exec", label: "Exec", description: "Run shell commands" }],
    });

    const result = resolveEffectiveToolInventory({ cfg: {} });

    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        {
          level: "warning",
          message: expect.stringContaining("Exec can run on gateway without approval prompts."),
        },
      ]),
    );
  });

  it("does not warn when host exec uses approval prompts", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [{ name: "exec", label: "Exec", description: "Run shell commands" }],
    });

    const result = resolveEffectiveToolInventory({
      cfg: { tools: { exec: { security: "allowlist", ask: "always" } } },
    });

    expect(result.diagnostics?.some((item) => item.message.includes("approval prompts"))).not.toBe(
      true,
    );
  });

  it("uses session exec overrides when diagnosing exec risk", async () => {
    const { resolveEffectiveToolInventory } = await loadHarness({
      tools: [{ name: "exec", label: "Exec", description: "Run shell commands" }],
    });

    const result = resolveEffectiveToolInventory({
      cfg: {},
      sessionEntry: {
        sessionId: "session-1",
        updatedAt: 0,
        execSecurity: "allowlist",
        execAsk: "always",
      },
    });

    expect(result.diagnostics?.some((item) => item.message.includes("approval prompts"))).not.toBe(
      true,
    );
  });
});
