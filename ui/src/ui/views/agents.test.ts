import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderAgents, type AgentsProps } from "./agents.ts";

function createSkill() {
  return {
    name: "Repo Skill",
    description: "Skill description",
    source: "workspace",
    filePath: "/tmp/skill",
    baseDir: "/tmp",
    skillKey: "repo-skill",
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    missing: {
      bins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [],
  };
}

function createProps(overrides: Partial<AgentsProps> = {}): AgentsProps {
  return {
    basePath: "",
    loading: false,
    error: null,
    agentsList: {
      defaultId: "alpha",
      mainKey: "main",
      scope: "workspace",
      agents: [{ id: "alpha", name: "Alpha" } as never, { id: "beta", name: "Beta" } as never],
    },
    selectedAgentId: "beta",
    activePanel: "overview",
    config: {
      form: null,
      loading: false,
      saving: false,
      dirty: false,
    },
    channels: {
      snapshot: null,
      loading: false,
      error: null,
      lastSuccess: null,
    },
    cron: {
      status: null,
      jobs: [],
      loading: false,
      error: null,
    },
    agentFiles: {
      list: null,
      loading: false,
      error: null,
      active: null,
      contents: {},
      drafts: {},
      saving: false,
    },
    agentIdentityLoading: false,
    agentIdentityError: null,
    agentIdentityById: {},
    agentSkills: {
      report: null,
      loading: false,
      error: null,
      agentId: null,
      filter: "",
    },
    toolsCatalog: {
      loading: false,
      error: null,
      result: null,
    },
    toolsEffective: {
      loading: false,
      error: null,
      result: null,
    },
    inspect: {
      loading: false,
      error: null,
      runId: null,
      taskId: null,
      timelineFilter: "all",
      snapshot: null,
    },
    runtimeSessionKey: "main",
    runtimeSessionMatchesSelectedAgent: false,
    runtimeRunId: null,
    modelCatalog: [],
    onRefresh: () => undefined,
    onSelectAgent: () => undefined,
    onSelectPanel: () => undefined,
    onLoadFiles: () => undefined,
    onSelectFile: () => undefined,
    onFileDraftChange: () => undefined,
    onFileReset: () => undefined,
    onFileSave: () => undefined,
    onToolsProfileChange: () => undefined,
    onToolsOverridesChange: () => undefined,
    onConfigReload: () => undefined,
    onConfigSave: () => undefined,
    onModelChange: () => undefined,
    onModelFallbacksChange: () => undefined,
    onChannelsRefresh: () => undefined,
    onCronRefresh: () => undefined,
    onCronRunNow: () => undefined,
    onSkillsFilterChange: () => undefined,
    onSkillsRefresh: () => undefined,
    onAgentSkillToggle: () => undefined,
    onAgentSkillsClear: () => undefined,
    onAgentSkillsDisableAll: () => undefined,
    onSetDefault: () => undefined,
    onInspectRefresh: () => undefined,
    onInspectCurrentRun: () => undefined,
    onInspectTimelineFilterChange: () => undefined,
    ...overrides,
  };
}

describe("renderAgents", () => {
  it("shows the skills count only for the selected agent's report", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          agentSkills: {
            report: {
              workspaceDir: "/tmp/workspace",
              managedSkillsDir: "/tmp/skills",
              skills: [createSkill()],
            },
            loading: false,
            error: null,
            agentId: "alpha",
            filter: "",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const skillsTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".agent-tab")).find(
      (button) => button.textContent?.includes("Skills"),
    );

    expect(skillsTab?.textContent?.trim()).toBe("Skills");
  });

  it("shows the selected agent's skills count when the report matches", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          agentSkills: {
            report: {
              workspaceDir: "/tmp/workspace",
              managedSkillsDir: "/tmp/skills",
              skills: [createSkill()],
            },
            loading: false,
            error: null,
            agentId: "beta",
            filter: "",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const skillsTab = Array.from(container.querySelectorAll<HTMLButtonElement>(".agent-tab")).find(
      (button) => button.textContent?.includes("Skills"),
    );

    expect(skillsTab?.textContent?.trim()).toContain("1");
  });

  it("renders inspect tab and panel content", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          uiMode: "advanced",
          activePanel: "inspect",
          inspect: {
            loading: false,
            error: null,
            runId: "run-123",
            taskId: null,
            timelineFilter: "all",
            snapshot: {
              lookup: { runId: "run-123" },
              runId: "run-123",
              refs: {},
              warnings: [],
              timeline: [],
            } as never,
          },
          runtimeRunId: "run-123",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Inspect");
    expect(container.textContent).toContain("Runtime Inspect");
    expect(container.textContent).toContain("run-123");
    expect(container.textContent).toContain("Runtime session");
    expect(container.textContent).toContain("Inspect state");
  });

  it("renders human-readable decision labels in inspect timeline", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          uiMode: "advanced",
          activePanel: "inspect",
          inspect: {
            loading: false,
            error: null,
            runId: "run-123",
            taskId: null,
            timelineFilter: "all",
            snapshot: {
              lookup: { runId: "run-123" },
              runId: "run-123",
              refs: {},
              warnings: [],
              timeline: [
                {
                  eventId: "evt-1",
                  type: "provider_request_start",
                  phase: "provider_request_start",
                  createdAt: Date.now(),
                  summary: "openai/gpt-5.4",
                  decisionCode: "provider_model_selected",
                  status: "ok",
                },
              ],
            } as never,
          },
          runtimeRunId: "run-123",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Provider model selected");
  });

  it("renders token breakdown and memory recall summary in inspect panel", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          uiMode: "advanced",
          activePanel: "inspect",
          inspect: {
            loading: false,
            error: null,
            runId: "run-123",
            taskId: null,
            timelineFilter: "all",
            snapshot: {
              lookup: { runId: "run-123" },
              runId: "run-123",
              refs: {},
              warnings: [],
              queryContext: {
                archiveRunId: "run-123",
                eventId: "evt-1",
                memoryRecall: {
                  hitReason: "session_memory_selected",
                  evictionReason: "durable_memory_prefetch_pending_fallback",
                  durableRecallSource: "durable_memory_prefetch_hit",
                  selectedItemIds: ["a", "b"],
                  omittedItemIds: ["c"],
                },
                providerRequestSnapshot: {
                  queryContextHash: "hash-1",
                  promptChars: 1200,
                  systemPromptChars: 400,
                  sectionTokenUsage: {
                    totalEstimatedTokens: 100,
                    byRole: { system: 70, user: 30 },
                    byType: { session_memory: 50, durable_memory: 20, routing: 30 },
                  },
                  sectionOrder: [],
                },
              },
            } as never,
          },
          runtimeRunId: "run-123",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Tokens by Role");
    expect(container.textContent).toContain("Tokens by Type");
    expect(container.textContent).toContain("Selected items");
    expect(container.textContent).toContain("2");
  });

  it("filters inspect timeline to decision events", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          uiMode: "advanced",
          activePanel: "inspect",
          inspect: {
            loading: false,
            error: null,
            runId: "run-123",
            taskId: null,
            timelineFilter: "decisions",
            snapshot: {
              lookup: { runId: "run-123" },
              runId: "run-123",
              refs: {},
              warnings: [],
              timeline: [
                {
                  eventId: "evt-1",
                  type: "provider_request_start",
                  phase: "provider_request_start",
                  createdAt: Date.now(),
                  summary: "with decision",
                  decisionCode: "provider_model_selected",
                  status: "ok",
                },
                {
                  eventId: "evt-2",
                  type: "settled_turn",
                  phase: "settled_turn",
                  createdAt: Date.now(),
                  summary: "without decision",
                  status: "ok",
                },
              ],
            } as never,
          },
          runtimeRunId: "run-123",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Showing 1 of 2 events.");
    expect(container.textContent).toContain("with decision");
    expect(container.textContent).not.toContain("without decision");
  });

  it("renders hook mutations and grouped provider section order", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          uiMode: "advanced",
          activePanel: "inspect",
          inspect: {
            loading: false,
            error: null,
            runId: "run-123",
            taskId: null,
            timelineFilter: "all",
            snapshot: {
              lookup: { runId: "run-123" },
              runId: "run-123",
              refs: {},
              warnings: [],
              queryContext: {
                archiveRunId: "run-123",
                eventId: "evt-1",
                hookMutations: [
                  {
                    hook: "before_prompt_build",
                    prependUserContextSections: 1,
                    appendUserContextSections: 0,
                    prependSystemContextSections: 0,
                    appendSystemContextSections: 2,
                    replaceSystemPromptSections: 1,
                    clearSystemContextSections: false,
                    replaceUserPrompt: true,
                  },
                ],
                providerRequestSnapshot: {
                  queryContextHash: "hash-1",
                  promptChars: 100,
                  systemPromptChars: 50,
                  sectionTokenUsage: {
                    totalEstimatedTokens: 10,
                    byRole: { system: 6, user: 4 },
                    byType: { routing: 2, durable_memory: 8 },
                  },
                  sectionOrder: [
                    {
                      id: "s1",
                      role: "system",
                      sectionType: "routing",
                      estimatedTokens: 2,
                    },
                    {
                      id: "u1",
                      role: "user",
                      sectionType: "durable_memory",
                      estimatedTokens: 8,
                    },
                  ],
                },
              },
            } as never,
          },
          runtimeRunId: "run-123",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Hook Mutations");
    expect(container.textContent).toContain("before_prompt_build");
    expect(container.textContent).toContain("Provider Section Order");
    expect(container.textContent).toContain("system");
    expect(container.textContent).toContain("user");
  });

  it("renders recent channel streaming decisions in inspect panel", async () => {
    const container = document.createElement("div");
    render(
      renderAgents(
        createProps({
          uiMode: "advanced",
          activePanel: "inspect",
          inspect: {
            loading: false,
            error: null,
            runId: "run-123",
            taskId: null,
            timelineFilter: "all",
            snapshot: {
              lookup: { runId: "run-123" },
              runId: "run-123",
              refs: {},
              warnings: [],
              channelStreaming: {
                recentDecisions: [
                  {
                    ts: Date.now(),
                    channel: "feishu",
                    accountId: "primary",
                    chatId: "chat-1",
                    enabled: false,
                    surface: "none",
                    reason: "disabled_for_thread_reply",
                  },
                ],
              },
            } as never,
          },
          runtimeRunId: "run-123",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Channel Streaming");
    expect(container.textContent).toContain("feishu");
    expect(container.textContent).toContain("fallback");
    expect(container.textContent).toContain("disabled for thread reply");
  });
});
