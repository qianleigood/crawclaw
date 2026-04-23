import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { collectCommandSecretAssignmentsFromSnapshot } from "./command-config.js";

describe("collectCommandSecretAssignmentsFromSnapshot", () => {
  it("returns assignments from the active runtime snapshot for configured refs", () => {
    const sourceConfig = {
      talk: {
        apiKey: { source: "env", provider: "default", id: "TALK_API_KEY" },
      },
    } as unknown as CrawClawConfig;
    const resolvedConfig = {
      talk: {
        apiKey: "talk-key", // pragma: allowlist secret
      },
    } as unknown as CrawClawConfig;

    const result = collectCommandSecretAssignmentsFromSnapshot({
      sourceConfig,
      resolvedConfig,
      commandName: "memory status",
      targetIds: new Set(["talk.apiKey"]),
    });

    expect(result.assignments).toEqual([
      {
        path: "talk.apiKey",
        pathSegments: ["talk", "apiKey"],
        value: "talk-key",
      },
    ]);
  });

  it("throws when configured refs are unresolved in the snapshot", () => {
    const sourceConfig = {
      talk: {
        apiKey: { source: "env", provider: "default", id: "TALK_API_KEY" },
      },
    } as unknown as CrawClawConfig;
    const resolvedConfig = {
      talk: {},
    } as unknown as CrawClawConfig;

    expect(() =>
      collectCommandSecretAssignmentsFromSnapshot({
        sourceConfig,
        resolvedConfig,
        commandName: "memory search",
        targetIds: new Set(["talk.apiKey"]),
      }),
    ).toThrow(/memory search: talk\.apiKey is unresolved in the active runtime snapshot/);
  });

  it("skips unresolved refs that are marked inactive by runtime warnings", () => {
    const sourceConfig = {
      talk: {
        apiKey: { source: "env", provider: "default", id: "TALK_API_KEY" },
      },
    } as unknown as CrawClawConfig;
    const resolvedConfig = {
      talk: {
        apiKey: { source: "env", provider: "default", id: "TALK_API_KEY" },
      },
    } as unknown as CrawClawConfig;

    const result = collectCommandSecretAssignmentsFromSnapshot({
      sourceConfig,
      resolvedConfig,
      commandName: "talk status",
      targetIds: new Set(["talk.apiKey"]),
      inactiveRefPaths: new Set(["talk.apiKey"]),
    });

    expect(result.assignments).toEqual([]);
    expect(result.diagnostics).toEqual([
      "talk.apiKey: secret ref is configured on an inactive surface; skipping command-time assignment.",
    ]);
  });
});
