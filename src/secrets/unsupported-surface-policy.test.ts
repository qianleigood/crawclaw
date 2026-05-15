import { describe, expect, it } from "vitest";
import {
  collectUnsupportedSecretRefConfigCandidates,
  UNSUPPORTED_SECRETREF_SURFACE_PATTERNS,
} from "./unsupported-surface-policy.js";

describe("unsupported SecretRef surface policy metadata", () => {
  it("exposes the canonical unsupported surface patterns", () => {
    expect(UNSUPPORTED_SECRETREF_SURFACE_PATTERNS).toEqual([
      "commands.ownerDisplaySecret",
      "hooks.token",
      "hooks.gmail.pushToken",
      "hooks.mappings[].sessionKey",
      "auth-profiles.oauth.*",
    ]);
  });

  it("discovers concrete config candidates for unsupported mutable surfaces", () => {
    const candidates = collectUnsupportedSecretRefConfigCandidates({
      commands: { ownerDisplaySecret: { source: "env", provider: "default", id: "OWNER" } },
      hooks: {
        token: { source: "env", provider: "default", id: "HOOK_TOKEN" },
        gmail: { pushToken: { source: "env", provider: "default", id: "GMAIL_PUSH" } },
        mappings: [{ sessionKey: { source: "env", provider: "default", id: "S0" } }],
      },
    });

    expect(candidates.map((candidate) => candidate.path).toSorted()).toEqual(
      [
        "commands.ownerDisplaySecret",
        "hooks.token",
        "hooks.gmail.pushToken",
        "hooks.mappings.0.sessionKey",
      ].toSorted(),
    );
  });
});
