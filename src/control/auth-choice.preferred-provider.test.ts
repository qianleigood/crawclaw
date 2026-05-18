import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveManifestProviderAuthChoice = vi.hoisted(() => vi.fn());
const resolveManifestProviderAuthChoices = vi.hoisted(() => vi.fn(() => []));

vi.mock("../plugins/provider-auth-choices.js", () => ({
  resolveManifestProviderAuthChoice,
  resolveManifestProviderAuthChoices,
}));

import { resolvePreferredProviderForAuthChoice } from "../plugins/provider-auth-choice-preference.js";

describe("resolvePreferredProviderForAuthChoice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveManifestProviderAuthChoice.mockReturnValue(undefined);
    resolveManifestProviderAuthChoices.mockReturnValue([]);
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
      methodId: "api-key",
      choiceId: "chutes-api-key",
      choiceLabel: "Chutes API key",
    });

    await expect(resolvePreferredProviderForAuthChoice({ choice: "chutes-api-key" })).resolves.toBe(
      "chutes",
    );
  });
});
