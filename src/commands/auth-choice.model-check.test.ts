import { beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveCliLocale } from "../cli/i18n/text.js";
import type { WizardPrompter } from "../wizard/prompts.js";

const mocks = vi.hoisted(() => ({
  ensureAuthProfileStore: vi.fn(() => ({ version: 1, profiles: {} })),
  listProfilesForProvider: vi.fn(() => []),
  hasUsableCustomProviderApiKey: vi.fn(() => false),
  resolveEnvApiKey: vi.fn(() => undefined),
  loadModelCatalog: vi.fn(async () => []),
  resolveDefaultModelForAgent: vi.fn(() => ({ provider: "anthropic", model: "sonnet-4.6" })),
  buildProviderAuthRecoveryHint: vi.fn(() => "Run `crawclaw configure`."),
}));

vi.mock("../agents/auth-profiles.js", () => ({
  ensureAuthProfileStore: mocks.ensureAuthProfileStore,
  listProfilesForProvider: mocks.listProfilesForProvider,
}));

vi.mock("../agents/model-auth.js", () => ({
  hasUsableCustomProviderApiKey: mocks.hasUsableCustomProviderApiKey,
  resolveEnvApiKey: mocks.resolveEnvApiKey,
}));

vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: mocks.loadModelCatalog,
}));

vi.mock("../agents/model-selection.js", () => ({
  resolveDefaultModelForAgent: mocks.resolveDefaultModelForAgent,
}));

vi.mock("./provider-auth-guidance.js", () => ({
  buildProviderAuthRecoveryHint: mocks.buildProviderAuthRecoveryHint,
}));

import { warnIfModelConfigLooksOff } from "./auth-choice.model-check.js";

describe("warnIfModelConfigLooksOff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActiveCliLocale("zh-CN");
  });

  it("localizes model check warnings in zh-CN", async () => {
    const prompter = {
      note: vi.fn(async () => {}),
    } as unknown as WizardPrompter & { note: ReturnType<typeof vi.fn> };

    await warnIfModelConfigLooksOff({} as never, prompter);

    expect(prompter.note).toHaveBeenCalledWith(
      'provider "anthropic" 尚未配置认证。在添加凭据前，agent 可能无法正常工作。\nRun `crawclaw configure`.',
      "模型检查",
    );
  });
});
