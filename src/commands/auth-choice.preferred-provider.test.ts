import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveManifestProviderAuthChoice = vi.hoisted(() => vi.fn());
const resolveManifestProviderAuthChoices = vi.hoisted(() => vi.fn(() => []));
const resolveProviderPluginChoice = vi.hoisted(() => vi.fn());
const resolvePluginProviders = vi.hoisted(() => vi.fn(() => []));

vi.mock("../plugins/provider-auth-choices.js", () => ({
  resolveManifestProviderAuthChoice,
  resolveManifestProviderAuthChoices,
}));

vi.mock("../plugins/provider-wizard.js", () => ({
  resolveProviderPluginChoice,
}));

vi.mock("../plugins/providers.runtime.js", () => ({
  resolvePluginProviders,
}));

import { resolvePreferredProviderForAuthChoice } from "../plugins/provider-auth-choice-preference.js";

describe("resolvePreferredProviderForAuthChoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveManifestProviderAuthChoice.mockReturnValue(undefined);
    resolveManifestProviderAuthChoices.mockReturnValue([]);
    resolvePluginProviders.mockReturnValue([]);
    resolveProviderPluginChoice.mockReturnValue(null);
  });

  it("prefers manifest metadata when available", async () => {
    resolveManifestProviderAuthChoice.mockReturnValue({
      pluginId: "openai",
      providerId: "openai",
      methodId: "api-key",
      choiceId: "openai-api-key",
      choiceLabel: "OpenAI API key",
    });

    await expect(resolvePreferredProviderForAuthChoice({ choice: "openai-api-key" })).resolves.toBe(
      "openai",
    );
    expect(resolvePluginProviders).not.toHaveBeenCalled();
  });

  it("does not resolve removed auth-choice aliases", async () => {
    const env = { CRAWCLAW_AUTH_CHOICE_TEST: "1" } as NodeJS.ProcessEnv;
    await expect(
      resolvePreferredProviderForAuthChoice({ choice: "claude-cli", env }),
    ).resolves.toBe(undefined);
  });

  it("uses manifest metadata for plugin-owned choices", async () => {
    resolveManifestProviderAuthChoice.mockReturnValue({
      pluginId: "chutes",
      providerId: "chutes",
      methodId: "oauth",
      choiceId: "chutes",
      choiceLabel: "Chutes OAuth",
    });

    await expect(resolvePreferredProviderForAuthChoice({ choice: "chutes" })).resolves.toBe(
      "chutes",
    );
    expect(resolvePluginProviders).not.toHaveBeenCalled();
  });
});
