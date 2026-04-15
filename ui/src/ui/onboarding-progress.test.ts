import { describe, expect, it } from "vitest";
import {
  areRecommendedSkillsReady,
  countConfiguredChannelsForOnboarding,
  countRememberedOnboardingSteps,
  createEmptyOnboardingProgress,
  deriveLiveOnboardingCompletion,
  highestRememberedOnboardingStep,
  isOnboardingFinished,
  mergeOnboardingProgress,
  onboardingProgressEquals,
  setOnboardingMode,
} from "./onboarding-progress.ts";

describe("onboarding progress", () => {
  it("counts configured channels across summaries and accounts", () => {
    expect(
      countConfiguredChannelsForOnboarding({
        ts: Date.now(),
        channelOrder: ["slack", "discord"],
        channelLabels: { slack: "Slack", discord: "Discord" },
        channels: {
          slack: { configured: true },
          discord: {},
        },
        channelAccounts: {
          slack: [],
          discord: [{ accountId: "default", configured: true }],
        },
        channelDefaultAccountId: {},
      }),
    ).toBe(2);
  });

  it("treats recommended bundled skills as ready only when all enabled bundled skills are eligible", () => {
    expect(
      areRecommendedSkillsReady({
        workspaceDir: "/tmp",
        managedSkillsDir: "/tmp/skills",
        skills: [
          {
            name: "coding-agent",
            description: "",
            source: "crawclaw-bundled",
            filePath: "",
            baseDir: "",
            skillKey: "coding-agent",
            bundled: true,
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: true,
            requirements: { bins: [], env: [], config: [], os: [] },
            missing: { bins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
        ],
      }),
    ).toBe(true);
    expect(
      areRecommendedSkillsReady({
        workspaceDir: "/tmp",
        managedSkillsDir: "/tmp/skills",
        skills: [
          {
            name: "coding-agent",
            description: "",
            source: "crawclaw-bundled",
            filePath: "",
            baseDir: "",
            skillKey: "coding-agent",
            bundled: true,
            always: false,
            disabled: false,
            blockedByAllowlist: false,
            eligible: false,
            requirements: { bins: [], env: [], config: [], os: [] },
            missing: { bins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
        ],
      }),
    ).toBe(false);
  });

  it("merges observed completions into remembered progress", () => {
    const progress = mergeOnboardingProgress(
      createEmptyOnboardingProgress(),
      {
        connected: true,
        assistantName: "CrawClaw",
        channelsSnapshot: null,
        skillsReport: null,
        sessionsCount: 0,
      },
      123,
    );

    expect(progress.completedAt.gateway).toBe(123);
    expect(progress.completedAt.agent).toBe(123);
    expect(progress.completedAt.channel).toBeUndefined();
    expect(countRememberedOnboardingSteps(progress)).toBe(2);
    expect(highestRememberedOnboardingStep(progress)).toBe("agent");
  });

  it("derives live completion and compares progress snapshots", () => {
    const live = deriveLiveOnboardingCompletion({
      connected: true,
      assistantName: "CrawClaw",
      channelsSnapshot: null,
      skillsReport: null,
      sessionsCount: 1,
    });
    expect(live.gateway).toBe(true);
    expect(live.agent).toBe(true);
    expect(live.chat).toBe(true);

    const a = { mode: "paused" as const, completedAt: { gateway: 1, chat: 2 } };
    const b = { mode: "paused" as const, completedAt: { gateway: 1, chat: 2 } };
    const c = { mode: "guided" as const, completedAt: { gateway: 1 } };
    expect(onboardingProgressEquals(a, b)).toBe(true);
    expect(onboardingProgressEquals(a, c)).toBe(false);
  });

  it("tracks onboarding mode changes and finish state", () => {
    const empty = createEmptyOnboardingProgress();
    expect(empty.mode).toBe("paused");

    const guided = setOnboardingMode(empty, "guided");
    expect(guided.mode).toBe("guided");
    expect(isOnboardingFinished(guided)).toBe(false);

    const finished = {
      mode: "guided" as const,
      completedAt: {
        gateway: 1,
        agent: 2,
        channel: 3,
        skills: 4,
        chat: 5,
      },
    };
    expect(isOnboardingFinished(finished)).toBe(true);
  });
});
