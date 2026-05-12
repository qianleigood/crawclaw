import { describe, expect, it } from "vitest";
import {
  augmentModelCatalogWithProviderPlugins,
  resolveProviderRuntimePlugin,
} from "./provider-runtime.js";

describe("provider-runtime production guardrail", () => {
  it("does not resolve bundled provider runtime hooks outside compatibility mode", async () => {
    const productionEnv = {} as NodeJS.ProcessEnv;

    expect(
      resolveProviderRuntimePlugin({
        provider: "openai",
        env: productionEnv,
      }),
    ).toBeUndefined();
    await expect(
      augmentModelCatalogWithProviderPlugins({
        env: productionEnv,
        context: {
          env: productionEnv,
          entries: [{ provider: "openai", id: "gpt-5.4", name: "GPT-5.4" }],
        },
      }),
    ).resolves.toEqual([]);
  });
});
