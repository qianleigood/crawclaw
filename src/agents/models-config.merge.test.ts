import { describe, expect, it } from "vitest";
import {
  mergeWithExistingProviderSecrets,
  type ExistingProviderConfig,
} from "./models-config.merge.js";
import type { ProviderConfig } from "./models-config.providers.secrets.js";

describe("models-config merge helpers", () => {
  const preservedApiKey = "AGENT_KEY"; // pragma: allowlist secret

  it("replaces stale baseUrl when model api surface changes", () => {
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        custom: {
          baseUrl: "https://config.example/v1",
          models: [{ id: "model", api: "openai-responses" }],
        } as ProviderConfig,
      },
      existingProviders: {
        custom: {
          baseUrl: "https://agent.example/v1",
          apiKey: preservedApiKey,
          models: [{ id: "model", api: "openai-completions" }],
        } as ExistingProviderConfig,
      },
      secretRefManagedProviders: new Set<string>(),
      explicitBaseUrlProviders: new Set<string>(),
    });

    expect(merged.custom).toEqual(
      expect.objectContaining({
        apiKey: preservedApiKey,
        baseUrl: "https://config.example/v1",
      }),
    );
  });

  it("does not preserve stale plaintext apiKey when next entry is a marker", () => {
    const merged = mergeWithExistingProviderSecrets({
      nextProviders: {
        custom: {
          apiKey: "OPENAI_API_KEY", // pragma: allowlist secret
          models: [{ id: "model", api: "openai-responses" }],
        } as ProviderConfig,
      },
      existingProviders: {
        custom: {
          apiKey: preservedApiKey,
          models: [{ id: "model", api: "openai-responses" }],
        } as ExistingProviderConfig,
      },
      secretRefManagedProviders: new Set<string>(),
      explicitBaseUrlProviders: new Set<string>(),
    });

    expect(merged.custom?.apiKey).toBe("OPENAI_API_KEY"); // pragma: allowlist secret
  });
});
