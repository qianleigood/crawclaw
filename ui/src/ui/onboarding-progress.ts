import type { ChannelsStatusSnapshot, SkillStatusReport } from "./types.ts";

export const ONBOARDING_STEP_ORDER = ["gateway", "agent", "channel", "skills", "chat"] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_ORDER)[number];
export type OnboardingMode = "guided" | "paused" | "completed";

export type OnboardingProgress = {
  mode?: OnboardingMode;
  completedAt: Partial<Record<OnboardingStepId, number>>;
};

export type OnboardingProgressInput = {
  connected: boolean;
  assistantName: string | null;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  skillsReport: SkillStatusReport | null;
  sessionsCount: number;
};

export function createEmptyOnboardingProgress(): OnboardingProgress {
  return { mode: "paused", completedAt: {} };
}

export function countRememberedOnboardingSteps(
  progress: OnboardingProgress | null | undefined,
): number {
  return ONBOARDING_STEP_ORDER.filter((step) => typeof progress?.completedAt?.[step] === "number")
    .length;
}

export function highestRememberedOnboardingStep(
  progress: OnboardingProgress | null | undefined,
): OnboardingStepId | null {
  let last: OnboardingStepId | null = null;
  for (const step of ONBOARDING_STEP_ORDER) {
    if (typeof progress?.completedAt?.[step] === "number") {
      last = step;
    }
  }
  return last;
}

export function countConfiguredChannelsForOnboarding(
  snapshot: ChannelsStatusSnapshot | null | undefined,
): number {
  if (!snapshot) {
    return 0;
  }
  let count = 0;
  for (const key of snapshot.channelOrder ?? []) {
    const status = snapshot.channels?.[key] as { configured?: unknown } | undefined;
    if (typeof status?.configured === "boolean" && status.configured) {
      count += 1;
      continue;
    }
    const accounts = snapshot.channelAccounts?.[key] ?? [];
    if (accounts.some((account) => account.configured || account.running || account.connected)) {
      count += 1;
    }
  }
  return count;
}

export function areRecommendedSkillsReady(report: SkillStatusReport | null | undefined): boolean {
  const recommended = (report?.skills ?? []).filter((skill) => skill.bundled && !skill.disabled);
  return recommended.length > 0 && recommended.every((skill) => skill.eligible);
}

export function deriveLiveOnboardingCompletion(
  input: OnboardingProgressInput,
): Record<OnboardingStepId, boolean> {
  return {
    gateway: input.connected,
    agent: Boolean(input.assistantName),
    channel: countConfiguredChannelsForOnboarding(input.channelsSnapshot) > 0,
    skills: areRecommendedSkillsReady(input.skillsReport),
    chat: input.sessionsCount > 0,
  };
}

export function mergeOnboardingProgress(
  progress: OnboardingProgress | null | undefined,
  input: OnboardingProgressInput,
  now = Date.now(),
): OnboardingProgress {
  const current = progress ?? createEmptyOnboardingProgress();
  const next: OnboardingProgress = {
    mode: current.mode ?? "guided",
    completedAt: { ...current.completedAt },
  };
  const live = deriveLiveOnboardingCompletion(input);
  for (const step of ONBOARDING_STEP_ORDER) {
    if (live[step] && typeof next.completedAt[step] !== "number") {
      next.completedAt[step] = now;
    }
  }
  return next;
}

export function onboardingProgressEquals(
  a: OnboardingProgress | null | undefined,
  b: OnboardingProgress | null | undefined,
): boolean {
  if ((a?.mode ?? "guided") !== (b?.mode ?? "guided")) {
    return false;
  }
  for (const step of ONBOARDING_STEP_ORDER) {
    if ((a?.completedAt?.[step] ?? null) !== (b?.completedAt?.[step] ?? null)) {
      return false;
    }
  }
  return true;
}

export function isOnboardingFinished(progress: OnboardingProgress | null | undefined): boolean {
  return countRememberedOnboardingSteps(progress) >= ONBOARDING_STEP_ORDER.length;
}

export function setOnboardingMode(
  progress: OnboardingProgress | null | undefined,
  mode: OnboardingMode,
): OnboardingProgress {
  const current = progress ?? createEmptyOnboardingProgress();
  return {
    mode,
    completedAt: { ...current.completedAt },
  };
}
