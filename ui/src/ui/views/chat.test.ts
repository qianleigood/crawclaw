/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.ts";
import { getSafeLocalStorage } from "../../local-storage.ts";
import { SKIP_DELETE_CONFIRM_KEY } from "../chat/grouped-render.ts";
import type { SessionsListResult } from "../types.ts";
import { renderChat, type ChatProps } from "./chat.ts";
import { renderOverview, type OverviewProps } from "./overview.ts";

function readDeleteConfirmPreference(): string | null {
  try {
    return getSafeLocalStorage()?.getItem(SKIP_DELETE_CONFIRM_KEY) ?? null;
  } catch {
    return null;
  }
}

function clearDeleteConfirmPreference(): void {
  try {
    getSafeLocalStorage()?.removeItem(SKIP_DELETE_CONFIRM_KEY);
  } catch {
    /* noop */
  }
}

function restoreDeleteConfirmPreference(value: string | null): void {
  try {
    if (value === null) {
      getSafeLocalStorage()?.removeItem(SKIP_DELETE_CONFIRM_KEY);
      return;
    }
    getSafeLocalStorage()?.setItem(SKIP_DELETE_CONFIRM_KEY, value);
  } catch {
    /* noop */
  }
}

function createSessions(): SessionsListResult {
  return {
    ts: 0,
    path: "",
    count: 0,
    defaults: { modelProvider: null, model: null, contextTokens: null },
    sessions: [],
  };
}

function createProps(overrides: Partial<ChatProps> = {}): ChatProps {
  return {
    sessionKey: "main",
    onSessionKeyChange: () => undefined,
    thinkingLevel: null,
    showThinking: false,
    showToolCalls: true,
    loading: false,
    sending: false,
    canAbort: false,
    compactionStatus: null,
    fallbackStatus: null,
    messages: [],
    toolMessages: [],
    streamSegments: [],
    stream: null,
    streamStartedAt: null,
    assistantAvatarUrl: null,
    draft: "",
    queue: [],
    connected: true,
    canSend: true,
    disabledReason: null,
    error: null,
    sessions: createSessions(),
    focusMode: false,
    assistantName: "CrawClaw",
    assistantAvatar: null,
    onRefresh: () => undefined,
    onToggleFocusMode: () => undefined,
    onDraftChange: () => undefined,
    onSend: () => undefined,
    onQueueRemove: () => undefined,
    onNewSession: () => undefined,
    agentsList: null,
    currentAgentId: "",
    onAgentChange: () => undefined,
    onInspectCurrentRun: () => undefined,
    onInspectRun: () => undefined,
    currentRunId: null,
    ...overrides,
  };
}

function createOverviewProps(overrides: Partial<OverviewProps> = {}): OverviewProps {
  return {
    assistantName: "CrawClaw",
    onboardingProgress: null,
    connected: false,
    hello: null,
    settings: {
      gatewayUrl: "",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "claw",
      themeMode: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      chatShowToolCalls: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navWidth: 220,
      navGroupsCollapsed: {},
      borderRadius: 50,
      locale: "en",
    },
    password: "",
    lastError: null,
    lastErrorCode: null,
    presenceCount: 0,
    sessionsCount: null,
    cronEnabled: null,
    cronNext: null,
    lastChannelsRefresh: null,
    feishuCliStatus: null,
    feishuCliLastSuccessAt: null,
    feishuCliSupported: null,
    feishuCliError: null,
    usageResult: null,
    sessionsResult: null,
    skillsReport: null,
    cronJobs: [],
    cronStatus: null,
    attentionItems: [],
    eventLog: [],
    overviewLogLines: [],
    showGatewayToken: false,
    showGatewayPassword: false,
    onSettingsChange: () => undefined,
    onPasswordChange: () => undefined,
    onSessionKeyChange: () => undefined,
    onToggleGatewayTokenVisibility: () => undefined,
    onToggleGatewayPasswordVisibility: () => undefined,
    onConnect: () => undefined,
    onRefresh: () => undefined,
    onNavigate: () => undefined,
    onRefreshLogs: () => undefined,
    onPauseOnboarding: () => undefined,
    onResumeOnboarding: () => undefined,
    onRestartOnboarding: () => undefined,
    onCompleteOnboarding: () => undefined,
    ...overrides,
  };
}

describe("chat view", () => {
  it("hides the context notice when only cumulative inputTokens exceed the limit", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 757_300,
                totalTokens: 46_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("context used");
    expect(container.textContent).not.toContain("757.3k / 200k");
  });

  it("uses totalTokens for the context notice detail when current usage is high", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 757_300,
                totalTokens: 190_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("95% context used");
    expect(container.textContent).toContain("190k / 200k");
    expect(container.textContent).not.toContain("757.3k / 200k");
  });

  it("renders inspect current run entry points in action feed", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          currentRunId: "run-123",
          actionFeed: [
            {
              actionId: "act-1",
              kind: "verification",
              title: "Verify output",
              status: "running",
              runId: "run-123",
              updatedAt: Date.now(),
            } as never,
          ],
        }),
      ),
      container,
    );

    expect(container.textContent).toContain("Inspect current run");
    expect(container.textContent).toContain("Inspect run");
  });

  it("renders the stitch-style chat console head", () => {
    const container = document.createElement("div");
    render(renderChat(createProps({ assistantName: "CrawClaw" })), container);

    expect(container.textContent).toContain("Sessions & chat console");
    expect(container.textContent).toContain("CrawClaw");
    expect(container.textContent).toContain("Queue / runtime");
  });

  it("renders inspect run action for tool stream messages", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          toolMessages: [
            {
              role: "assistant",
              runId: "run-tool-1",
              toolCallId: "call-1",
              content: [
                { type: "toolcall", name: "Read", arguments: { path: "/tmp/a" } },
                { type: "toolresult", name: "Read", text: "ok" },
              ],
              timestamp: Date.now(),
            },
          ],
        }),
      ),
      container,
    );

    expect(container.querySelector('[aria-label="Inspect run"]')).not.toBeNull();
  });

  it("hides the context notice when totalTokens is missing even if inputTokens is high", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                inputTokens: 500_000,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("context used");
  });

  it("hides the context notice when totalTokens is marked stale", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          sessions: {
            ts: 0,
            path: "",
            count: 1,
            defaults: { modelProvider: "openai", model: "gpt-5", contextTokens: 200_000 },
            sessions: [
              {
                key: "main",
                kind: "direct",
                updatedAt: null,
                totalTokens: 190_000,
                totalTokensFresh: false,
                contextTokens: 200_000,
              },
            ],
          },
        }),
      ),
      container,
    );

    expect(container.textContent).not.toContain("context used");
    expect(container.textContent).not.toContain("190k / 200k");
  });

  it("uses the assistant avatar URL for the welcome state when the identity avatar is only initials", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: "/avatar/main",
        }),
      ),
      container,
    );

    const welcomeImage = container.querySelector<HTMLImageElement>(".agent-chat__welcome > img");
    expect(welcomeImage).not.toBeNull();
    expect(welcomeImage?.getAttribute("src")).toBe("/avatar/main");
  });

  it("falls back to the bundled logo in the welcome state when the assistant avatar is not a URL", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
        }),
      ),
      container,
    );

    const welcomeImage = container.querySelector<HTMLImageElement>(".agent-chat__welcome > img");
    const logoImage = container.querySelector<HTMLImageElement>(
      ".agent-chat__welcome .agent-chat__avatar--logo img",
    );
    expect(welcomeImage).toBeNull();
    expect(logoImage).not.toBeNull();
    expect(logoImage?.getAttribute("src")).toBe("favicon.svg");
  });

  it("keeps the welcome logo fallback under the mounted base path", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
          basePath: "/crawclaw/",
        }),
      ),
      container,
    );

    const logoImage = container.querySelector<HTMLImageElement>(
      ".agent-chat__welcome .agent-chat__avatar--logo img",
    );
    expect(logoImage).not.toBeNull();
    expect(logoImage?.getAttribute("src")).toBe("/crawclaw/favicon.svg");
  });

  it("keeps grouped assistant avatar fallbacks under the mounted base path", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          assistantName: "Assistant",
          assistantAvatar: "A",
          assistantAvatarUrl: null,
          basePath: "/crawclaw/",
          messages: [
            {
              role: "assistant",
              content: "hello",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    const groupedLogo = container.querySelector<HTMLImageElement>(
      ".chat-group.assistant .chat-avatar--logo",
    );
    expect(groupedLogo).not.toBeNull();
    expect(groupedLogo?.getAttribute("src")).toBe("/crawclaw/favicon.svg");
  });

  it("keeps the persisted overview locale selected before i18n hydration finishes", async () => {
    const container = document.createElement("div");
    const props = createOverviewProps({
      settings: {
        ...createOverviewProps().settings,
        locale: "zh-CN",
      },
    });

    getSafeLocalStorage()?.clear();
    await i18n.setLocale("en");

    render(renderOverview(props), container);
    await Promise.resolve();

    let select = container.querySelector<HTMLSelectElement>("select");
    expect(i18n.getLocale()).toBe("en");
    expect(select?.value).toBe("zh-CN");
    expect(select?.selectedOptions[0]?.textContent?.trim()).toBe("简体中文 (Simplified Chinese)");

    await i18n.setLocale("zh-CN");
    render(renderOverview(props), container);
    await Promise.resolve();

    select = container.querySelector<HTMLSelectElement>("select");
    expect(select?.value).toBe("zh-CN");
    expect(select?.selectedOptions[0]?.textContent?.trim()).toBe("简体中文 (简体中文)");

    await i18n.setLocale("en");
  });

  it("renders Feishu user status on overview", async () => {
    const container = document.createElement("div");
    render(
      renderOverview(
        createOverviewProps({
          connected: true,
          feishuCliSupported: true,
          feishuCliStatus: {
            identity: "user",
            enabled: true,
            command: "lark-cli",
            timeoutMs: 8000,
            installed: true,
            version: "1.0.7",
            authOk: true,
            status: "ready",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Feishu user");
    expect(container.textContent).toContain("ready");
    expect(container.textContent).toContain("lark-cli 1.0.7");
    expect(container.textContent).toContain("plugins.entries.feishu-cli.config");
    expect(container.textContent).toContain("crawclaw feishu-cli status --verify");
  });

  it("renders Feishu user auth recovery guidance on overview", async () => {
    const container = document.createElement("div");
    render(
      renderOverview(
        createOverviewProps({
          connected: true,
          feishuCliSupported: true,
          feishuCliStatus: {
            identity: "user",
            enabled: true,
            command: "lark-cli",
            timeoutMs: 8000,
            installed: true,
            authOk: false,
            status: "not_configured",
            message: "Run crawclaw feishu-cli auth login first.",
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Run crawclaw feishu-cli auth login first.");
    expect(container.textContent).toContain("crawclaw feishu-cli status --verify");
  });

  it("renders the guided setup path on overview", async () => {
    const container = document.createElement("div");
    render(
      renderOverview(
        createOverviewProps({
          connected: true,
          assistantName: "CrawClaw",
          hello: {
            ok: true,
            snapshot: {
              channels: {
                feishu: { status: "ok" },
              },
            },
          } as unknown as OverviewProps["hello"],
          skillsReport: {
            ts: 0,
            skills: [
              {
                name: "coding-agent",
                disabled: false,
                eligible: true,
              },
            ],
          } as unknown as OverviewProps["skillsReport"],
          sessionsResult: {
            ts: 0,
            path: "",
            count: 1,
            defaults: {},
            sessions: [],
          } as unknown as OverviewProps["sessionsResult"],
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Setup path");
    expect(container.textContent).toContain("Choose a default agent");
    expect(container.textContent).toContain("Send a test message");
  });

  it("renders the onboarding wizard when onboarding mode is enabled", async () => {
    const container = document.createElement("div");
    render(
      renderOverview(
        createOverviewProps({
          onboarding: true,
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent).toContain("Set up CrawClaw in five guided steps");
    expect(container.textContent).toContain("Step 1 of 5");
    expect(container.textContent).toContain("Current step");
  });

  it("renders compacting indicator as a badge", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "active",
            runId: "run-1",
            startedAt: Date.now(),
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--active");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Compacting context...");
  });

  it("renders retry-pending compaction indicator as a badge", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "retrying",
            runId: "run-1",
            startedAt: Date.now(),
            completedAt: null,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--active");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Retrying after compaction...");
  });

  it("renders completion indicator shortly after compaction", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "complete",
            runId: "run-1",
            startedAt: 900,
            completedAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--complete");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Context compacted");
    nowSpy.mockRestore();
  });

  it("hides stale compaction completion indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(10_000);
    render(
      renderChat(
        createProps({
          compactionStatus: {
            phase: "complete",
            runId: "run-1",
            startedAt: 0,
            completedAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator")).toBeNull();
    nowSpy.mockRestore();
  });

  it("renders fallback indicator shortly after fallback event", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            selected: "fireworks/minimax-m2p5",
            active: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: ["fireworks/minimax-m2p5: rate limit"],
            occurredAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--fallback");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Fallback active: deepinfra/moonshotai/Kimi-K2.5");
    nowSpy.mockRestore();
  });

  it("hides stale fallback indicator", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(20_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            selected: "fireworks/minimax-m2p5",
            active: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: [],
            occurredAt: 0,
          },
        }),
      ),
      container,
    );

    expect(container.querySelector(".compaction-indicator--fallback")).toBeNull();
    nowSpy.mockRestore();
  });

  it("renders fallback-cleared indicator shortly after transition", () => {
    const container = document.createElement("div");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(
      renderChat(
        createProps({
          fallbackStatus: {
            phase: "cleared",
            selected: "fireworks/minimax-m2p5",
            active: "fireworks/minimax-m2p5",
            previous: "deepinfra/moonshotai/Kimi-K2.5",
            attempts: [],
            occurredAt: 900,
          },
        }),
      ),
      container,
    );

    const indicator = container.querySelector(".compaction-indicator--fallback-cleared");
    expect(indicator).not.toBeNull();
    expect(indicator?.textContent).toContain("Fallback cleared: fireworks/minimax-m2p5");
    nowSpy.mockRestore();
  });

  it("renders action feed entries", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          actionFeed: [
            {
              actionId: "tool-1",
              runId: "run-1",
              version: 1,
              kind: "tool",
              status: "running",
              title: "Running exec",
              summary: "pnpm test auth",
              updatedAt: 1,
            },
          ],
        }),
      ),
      container,
    );

    const feed = container.querySelector(".action-feed");
    expect(feed).not.toBeNull();
    expect(feed?.textContent).toContain("Action Feed");
    expect(feed?.textContent).toContain("Running exec");
    expect(feed?.textContent).toContain("pnpm test auth");
  });

  it("prefers projected action feed text when present", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          actionFeed: [
            {
              actionId: "workflow-1",
              runId: "run-1",
              version: 1,
              kind: "workflow",
              status: "running",
              title: "raw workflow title",
              projectedTitle: "Running workflow: Publish Redbook",
              summary: "raw summary",
              updatedAt: 1,
            },
          ],
        }),
      ),
      container,
    );

    const feed = container.querySelector(".action-feed");
    expect(feed?.textContent).toContain("Running workflow: Publish Redbook");
    expect(feed?.textContent).not.toContain("raw workflow title");
  });

  it("renders action feed details when structured detail is present", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          actionFeed: [
            {
              actionId: "verification-1",
              runId: "verification:tool-1",
              version: 1,
              kind: "verification",
              status: "blocked",
              title: "Verification FAIL",
              summary: "Second login did not trigger retry",
              detail: {
                verdict: "FAIL",
                childRunId: "run-verify-1",
                checks: ["retry flow", "second login"],
              },
              updatedAt: 1,
            },
          ],
        }),
      ),
      container,
    );

    const detailBlock = container.querySelector(".action-feed__details-body");
    expect(detailBlock).not.toBeNull();
    expect(detailBlock?.textContent).toContain('"verdict": "FAIL"');
    expect(detailBlock?.textContent).toContain('"childRunId": "run-verify-1"');
  });

  it("shows a stop button when aborting is available", () => {
    const container = document.createElement("div");
    const onAbort = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: true,
          sending: true,
          onAbort,
        }),
      ),
      container,
    );

    const stopButton = container.querySelector<HTMLButtonElement>('button[title="Stop"]');
    expect(stopButton).not.toBeUndefined();
    stopButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("New session");
  });

  it("shows a new session button when aborting is unavailable", () => {
    const container = document.createElement("div");
    const onNewSession = vi.fn();
    render(
      renderChat(
        createProps({
          canAbort: false,
          onNewSession,
        }),
      ),
      container,
    );

    const newSessionButton = container.querySelector<HTMLButtonElement>(
      'button[title="New session"]',
    );
    expect(newSessionButton).not.toBeUndefined();
    newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Stop");
  });

  it("shows sender labels from sanitized gateway messages instead of generic You", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "hello from topic",
              senderLabel: "Iris",
              timestamp: 1000,
            },
          ],
        }),
      ),
      container,
    );

    const senderLabels = Array.from(container.querySelectorAll(".chat-sender-name")).map((node) =>
      node.textContent?.trim(),
    );
    expect(senderLabels).toContain("Iris");
    expect(senderLabels).not.toContain("You");
  });

  it("keeps consecutive user messages from different senders in separate groups", () => {
    const container = document.createElement("div");
    render(
      renderChat(
        createProps({
          messages: [
            {
              role: "user",
              content: "first",
              senderLabel: "Iris",
              timestamp: 1000,
            },
            {
              role: "user",
              content: "second",
              senderLabel: "Joaquin De Rojas",
              timestamp: 1001,
            },
          ],
        }),
      ),
      container,
    );

    const groups = container.querySelectorAll(".chat-group.user");
    expect(groups).toHaveLength(2);
    const senderLabels = Array.from(container.querySelectorAll(".chat-sender-name")).map((node) =>
      node.textContent?.trim(),
    );
    expect(senderLabels).toContain("Iris");
    expect(senderLabels).toContain("Joaquin De Rojas");
  });

  it("opens delete confirm on the left for user messages", () => {
    const originalPreference = readDeleteConfirmPreference();
    clearDeleteConfirmPreference();
    const container = document.createElement("div");
    try {
      render(
        renderChat(
          createProps({
            messages: [
              {
                role: "user",
                content: "hello from user",
                timestamp: 1000,
              },
            ],
          }),
        ),
        container,
      );

      const deleteButton = container.querySelector<HTMLButtonElement>(
        ".chat-group.user .chat-group-delete",
      );
      expect(deleteButton).not.toBeNull();
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const confirm = container.querySelector<HTMLElement>(".chat-group.user .chat-delete-confirm");
      expect(confirm).not.toBeNull();
      expect(confirm?.classList.contains("chat-delete-confirm--left")).toBe(true);
    } finally {
      restoreDeleteConfirmPreference(originalPreference);
    }
  });

  it("opens delete confirm on the right for assistant messages", () => {
    const originalPreference = readDeleteConfirmPreference();
    clearDeleteConfirmPreference();
    const container = document.createElement("div");
    try {
      render(
        renderChat(
          createProps({
            messages: [
              {
                role: "assistant",
                content: "hello from assistant",
                timestamp: 1000,
              },
            ],
          }),
        ),
        container,
      );

      const deleteButton = container.querySelector<HTMLButtonElement>(
        ".chat-group.assistant .chat-group-delete",
      );
      expect(deleteButton).not.toBeNull();
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const confirm = container.querySelector<HTMLElement>(
        ".chat-group.assistant .chat-delete-confirm",
      );
      expect(confirm).not.toBeNull();
      expect(confirm?.classList.contains("chat-delete-confirm--right")).toBe(true);
    } finally {
      restoreDeleteConfirmPreference(originalPreference);
    }
  });

  it("renders delete confirm with the expected safe structure", () => {
    const originalPreference = readDeleteConfirmPreference();
    clearDeleteConfirmPreference();
    const container = document.createElement("div");
    try {
      render(
        renderChat(
          createProps({
            messages: [
              {
                role: "assistant",
                content: "hello from assistant",
                timestamp: 1000,
              },
            ],
          }),
        ),
        container,
      );

      const deleteButton = container.querySelector<HTMLButtonElement>(
        ".chat-group.assistant .chat-group-delete",
      );
      expect(deleteButton).not.toBeNull();
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

      const confirm = container.querySelector<HTMLElement>(
        ".chat-group.assistant .chat-delete-confirm",
      );
      expect(confirm?.querySelector(".chat-delete-confirm__text")?.textContent).toBe(
        "Delete this message?",
      );
      expect(confirm?.querySelector(".chat-delete-confirm__remember span")?.textContent).toBe(
        "Don't ask again",
      );
      expect(confirm?.querySelector<HTMLButtonElement>(".chat-delete-confirm__cancel")?.type).toBe(
        "button",
      );
      expect(confirm?.querySelector<HTMLButtonElement>(".chat-delete-confirm__yes")?.type).toBe(
        "button",
      );
      expect(confirm?.querySelector<HTMLInputElement>(".chat-delete-confirm__check")?.type).toBe(
        "checkbox",
      );
    } finally {
      restoreDeleteConfirmPreference(originalPreference);
    }
  });
});
