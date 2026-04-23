import { describe, expect, it } from "vitest";
import { REDACTED_SENTINEL, redactConfigSnapshot } from "./redact-snapshot.js";
import { makeSnapshot, restoreRedactedValues } from "./redact-snapshot.test-helpers.js";
import { redactSnapshotTestHints as mainSchemaHints } from "./redact-snapshot.test-hints.js";
import { buildConfigSchema } from "./schema.js";

describe("realredactConfigSnapshot_real", () => {
  it("main schema redact works (samples)", () => {
    const snapshot = makeSnapshot({
      gateway: {
        auth: {
          password: "1234",
        },
      },
      models: {
        providers: {
          openai: {
            apiKey: "6789",
          },
        },
      },
    });

    const result = redactConfigSnapshot(snapshot, mainSchemaHints);
    const config = result.runtimeConfig as typeof snapshot.runtimeConfig;
    expect(config.gateway.auth.password).toBe(REDACTED_SENTINEL);
    expect(config.models.providers.openai.apiKey).toBe(REDACTED_SENTINEL);
    const restored = restoreRedactedValues(
      result.runtimeConfig,
      snapshot.runtimeConfig,
      mainSchemaHints,
    );
    expect(restored.gateway.auth.password).toBe("1234");
    expect(restored.models.providers.openai.apiKey).toBe("6789");
  });

  it("redacts bundled channel private keys from generated schema hints", () => {
    const hints = buildConfigSchema().uiHints;
    const snapshot = makeSnapshot({
      channels: {
        nostr: {
          privateKey: "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
          relays: ["wss://relay.example.com"],
        },
      },
    });

    const result = redactConfigSnapshot(snapshot, hints);
    const channels = result.runtimeConfig.channels as Record<string, Record<string, unknown>>;
    expect(channels.nostr.privateKey).toBe(REDACTED_SENTINEL);

    const restored = restoreRedactedValues(result.runtimeConfig, snapshot.runtimeConfig, hints);
    expect(restored.channels.nostr.privateKey).toBe(
      "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5",
    );
  });
});
