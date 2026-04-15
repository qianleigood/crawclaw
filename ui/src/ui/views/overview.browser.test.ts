import { render } from "lit";
import { describe, expect, it } from "vitest";
import { renderOverview, type OverviewProps } from "./overview.ts";

function createOverviewProps(overrides: Partial<OverviewProps> = {}): OverviewProps {
  return {
    assistantName: "CrawClaw",
    uiMode: "simple",
    onboarding: false,
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
      uiMode: "simple",
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

describe("overview (browser)", () => {
  it("renders the onboarding wizard instead of the compact setup path in onboarding mode", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderOverview(
        createOverviewProps({
          onboarding: true,
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Set up CrawClaw in five guided steps");
    expect(text).toContain("Step 1 of 5");
    expect(text).toContain("Connect gateway");
    expect(text).toContain("Connect now");
    container.remove();
  });

  it("renders the compact setup path outside onboarding mode", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(renderOverview(createOverviewProps()), container);
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Set up CrawClaw without leaving the UI.");
    expect(text).toContain("Setup path");
    expect(text).not.toContain("Set up CrawClaw in five guided steps");
    container.remove();
  });

  it("shows resume controls when guided setup is paused", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    render(
      renderOverview(
        createOverviewProps({
          onboarding: false,
          onboardingProgress: {
            mode: "paused",
            completedAt: { gateway: 1, agent: 2 },
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Guided setup paused.");
    expect(text).toContain("Resume guided setup");
    expect(text).toContain("Restart from step 1");
    container.remove();
  });
});
