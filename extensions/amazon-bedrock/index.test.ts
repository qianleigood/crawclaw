import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { registerSingleProviderPlugin } from "../../test/helpers/plugins/plugin-registration.js";
import amazonBedrockPlugin from "./index.js";

describe("amazon-bedrock provider plugin", () => {
  it("marks Claude 4.6 Bedrock models as adaptive by default", () => {
    const provider = registerSingleProviderPlugin(amazonBedrockPlugin);

    expect(
      provider.resolveDefaultThinkingLevel?.({
        provider: "amazon-bedrock",
        modelId: "us.anthropic.claude-opus-4-6-v1",
      } as never),
    ).toBe("adaptive");
    expect(
      provider.resolveDefaultThinkingLevel?.({
        provider: "amazon-bedrock",
        modelId: "amazon.nova-micro-v1:0",
      } as never),
    ).toBeUndefined();
  });

  describe("guardrail config schema", () => {
    it("defines guardrail object with correct property types, required fields, and enums", () => {
      const pluginJson = JSON.parse(
        readFileSync(resolve(import.meta.dirname, "crawclaw.plugin.json"), "utf-8"),
      );
      const guardrail = pluginJson.configSchema?.properties?.guardrail;

      expect(guardrail).toBeDefined();
      expect(guardrail.type).toBe("object");
      expect(guardrail.additionalProperties).toBe(false);

      // Required fields
      expect(guardrail.required).toEqual(["guardrailIdentifier", "guardrailVersion"]);

      // Property types
      expect(guardrail.properties.guardrailIdentifier).toEqual({ type: "string" });
      expect(guardrail.properties.guardrailVersion).toEqual({ type: "string" });

      // Enum constraints
      expect(guardrail.properties.streamProcessingMode).toEqual({
        type: "string",
        enum: ["sync", "async"],
      });
      expect(guardrail.properties.trace).toEqual({
        type: "string",
        enum: ["enabled", "disabled", "enabled_full"],
      });
    });
  });
});
