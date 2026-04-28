import { describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { buildCommandsMessage, buildHelpMessage, buildToolsMessage } from "./status.js";

vi.mock("../plugins/commands.js", () => ({
  listPluginCommands: () => [],
}));

describe("tools product copy", () => {
  it("mentions /tools in command discovery copy", () => {
    const cfg = {
      commands: { config: false, debug: false },
    } as unknown as CrawClawConfig;

    expect(buildCommandsMessage(cfg)).toContain("/tools - List available runtime tools.");
    expect(buildCommandsMessage(cfg)).toContain("More: /tools for available capabilities");
    expect(buildHelpMessage(cfg)).toContain("/tools for available capabilities");
    expect(buildHelpMessage(cfg)).toContain("/tasks");
  });

  it("formats built-in and plugin tools for end users", () => {
    const text = buildToolsMessage({
      agentId: "main",
      profile: "coding",
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
            {
              id: "web_search",
              label: "Web Search",
              description: "Search the web",
              rawDescription: "Search the web",
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
              description: "Search internal documentation",
              rawDescription: "Search internal documentation",
              source: "plugin",
              pluginId: "docs",
            },
          ],
        },
      ],
    });

    expect(text).toContain("Available tools");
    expect(text).toContain("Profile: coding");
    expect(text).toContain("Built-in tools");
    expect(text).toContain("exec, web_search");
    expect(text).toContain("Connected tools");
    expect(text).toContain("docs_lookup (docs)");
    expect(text).toContain("Use /tools verbose for descriptions.");
    expect(text).not.toContain("unavailable right now");
  });

  it("localizes tool list framing for zh-CN", () => {
    const text = buildToolsMessage(
      {
        agentId: "main",
        profile: "coding",
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
        ],
      },
      { cfg: { cli: { language: "zh-CN" } } as CrawClawConfig },
    );

    expect(text).toContain("可用工具");
    expect(text).toContain("配置档：coding");
    expect(text).toContain("使用 /tools verbose 查看描述。");
  });

  it("keeps detailed descriptions in verbose mode", () => {
    const text = buildToolsMessage(
      {
        agentId: "main",
        profile: "minimal",
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
        ],
        unavailableTools: [
          {
            id: "exec",
            label: "exec",
            source: "core",
            reason: "not included in tools.profile (minimal)",
          },
        ],
        diagnostics: [
          {
            level: "warning",
            message:
              "tools: tools.allow allowlist contains unknown entries (wat). These entries won't match any tool unless the plugin is enabled.",
          },
        ],
      },
      { verbose: true },
    );

    expect(text).toContain("What this agent can use right now:");
    expect(text).toContain("Profile: minimal");
    expect(text).toContain("Exec - Run shell commands");
    expect(text).toContain("Unavailable tools");
    expect(text).toContain("exec - not included in tools.profile (minimal)");
    expect(text).toContain("Warnings");
    expect(text).toContain("unknown entries (wat)");
    expect(text).toContain("Tool availability depends on this agent's configuration.");
  });

  it("trims verbose output before schema-like doc blocks", () => {
    const text = buildToolsMessage(
      {
        agentId: "main",
        profile: "coding",
        groups: [
          {
            id: "core",
            label: "Built-in tools",
            source: "core",
            tools: [
              {
                id: "cron",
                label: "Cron",
                description: "Schedule and manage cron jobs.",
                rawDescription:
                  "Manage Gateway cron jobs and send wake events.\n\nACTIONS:\n- status: Check cron scheduler status\nJOB SCHEMA:\n{ ... }",
                source: "core",
              },
            ],
          },
        ],
      },
      { verbose: true },
    );

    expect(text).toContain("Cron - Manage Gateway cron jobs and send wake events.");
    expect(text).not.toContain("ACTIONS:");
    expect(text).not.toContain("JOB SCHEMA:");
  });

  it("returns the empty state when no tools are available", () => {
    expect(
      buildToolsMessage({
        agentId: "main",
        profile: "full",
        groups: [],
      }),
    ).toBe("No tools are available for this agent right now.\n\nProfile: full");
  });
});
