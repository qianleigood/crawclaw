import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import { captureEnv } from "../test-utils/env.js";
import {
  maybeRemoveDeprecatedCliAuthProfiles,
  maybeRepairLegacyOAuthProfileIds,
} from "./doctor-auth.js";
import type { DoctorPrompter } from "./doctor-prompter.js";
import type { DoctorRepairMode } from "./doctor-repair-mode.js";

let envSnapshot: ReturnType<typeof captureEnv>;
let tempAgentDir: string | undefined;

function makePrompter(confirmValue: boolean): DoctorPrompter {
  const repairMode: DoctorRepairMode = {
    shouldRepair: confirmValue,
    shouldForce: false,
    nonInteractive: false,
    canPrompt: true,
    updateInProgress: false,
  };
  return {
    confirm: vi.fn().mockResolvedValue(confirmValue),
    confirmAutoFix: vi.fn().mockResolvedValue(confirmValue),
    confirmAggressiveAutoFix: vi.fn().mockResolvedValue(confirmValue),
    confirmRuntimeRepair: vi.fn().mockResolvedValue(confirmValue),
    select: vi.fn().mockResolvedValue(""),
    shouldRepair: repairMode.shouldRepair,
    shouldForce: repairMode.shouldForce,
    repairMode,
  };
}

beforeEach(() => {
  envSnapshot = captureEnv(["CRAWCLAW_AGENT_DIR", "PI_CODING_AGENT_DIR"]);
  tempAgentDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-auth-"));
  process.env.CRAWCLAW_AGENT_DIR = tempAgentDir;
  process.env.PI_CODING_AGENT_DIR = tempAgentDir;
});

afterEach(() => {
  envSnapshot.restore();
  if (tempAgentDir) {
    fs.rmSync(tempAgentDir, { recursive: true, force: true });
    tempAgentDir = undefined;
  }
});

describe("maybeRemoveDeprecatedCliAuthProfiles", () => {
  it("leaves deprecated CLI auth profiles untouched without TS provider metadata", async () => {
    if (!tempAgentDir) {
      throw new Error("Missing temp agent dir");
    }
    const authPath = path.join(tempAgentDir, "auth-profiles.json");
    fs.writeFileSync(
      authPath,
      `${JSON.stringify(
        {
          version: 1,
          profiles: {
            "anthropic:claude-cli": {
              type: "oauth",
              provider: "anthropic",
              access: "token-a",
              refresh: "token-r",
              expires: Date.now() + 60_000,
            },
            "openai-codex:codex-cli": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-b",
              refresh: "token-r2",
              expires: Date.now() + 60_000,
            },
            "openai-codex:default": {
              type: "oauth",
              provider: "openai-codex",
              access: "token-c",
              refresh: "token-r3",
              expires: Date.now() + 60_000,
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const cfg = {
      auth: {
        profiles: {
          "anthropic:claude-cli": { provider: "anthropic", mode: "oauth" },
          "openai-codex:codex-cli": { provider: "openai-codex", mode: "oauth" },
          "openai-codex:default": { provider: "openai-codex", mode: "oauth" },
        },
        order: {
          anthropic: ["anthropic:claude-cli"],
          "openai-codex": ["openai-codex:codex-cli", "openai-codex:default"],
        },
      },
    } as const;

    const next = await maybeRemoveDeprecatedCliAuthProfiles(
      cfg as unknown as CrawClawConfig,
      makePrompter(true),
    );

    const raw = JSON.parse(fs.readFileSync(authPath, "utf8")) as {
      profiles?: Record<string, unknown>;
    };
    expect(raw.profiles?.["anthropic:claude-cli"]).toBeDefined();
    expect(raw.profiles?.["openai-codex:codex-cli"]).toBeDefined();
    expect(raw.profiles?.["openai-codex:default"]).toBeDefined();

    expect(next.auth?.profiles?.["anthropic:claude-cli"]).toBeDefined();
    expect(next.auth?.profiles?.["openai-codex:codex-cli"]).toBeDefined();
    expect(next.auth?.profiles?.["openai-codex:default"]).toBeDefined();
    expect(next.auth?.order?.anthropic).toEqual(["anthropic:claude-cli"]);
    expect(next.auth?.order?.["openai-codex"]).toEqual([
      "openai-codex:codex-cli",
      "openai-codex:default",
    ]);
  });
});

describe("maybeRepairLegacyOAuthProfileIds", () => {
  it("leaves legacy OAuth profile ids untouched without TS provider metadata", async () => {
    if (!tempAgentDir) {
      throw new Error("Missing temp agent dir");
    }
    const authPath = path.join(tempAgentDir, "auth-profiles.json");
    fs.writeFileSync(
      authPath,
      `${JSON.stringify(
        {
          version: 1,
          profiles: {
            "anthropic:user@example.com": {
              type: "oauth",
              provider: "anthropic",
              access: "token-a",
              refresh: "token-r",
              expires: Date.now() + 60_000,
              email: "user@example.com",
            },
          },
          lastGood: {
            anthropic: "anthropic:user@example.com",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const next = await maybeRepairLegacyOAuthProfileIds(
      {
        auth: {
          profiles: {
            "anthropic:default": { provider: "anthropic", mode: "oauth" },
          },
          order: {
            anthropic: ["anthropic:default"],
          },
        },
      } as CrawClawConfig,
      makePrompter(true),
    );

    expect(next.auth?.profiles?.["anthropic:default"]).toMatchObject({
      provider: "anthropic",
      mode: "oauth",
    });
    expect(next.auth?.profiles?.["anthropic:user@example.com"]).toBeUndefined();
    expect(next.auth?.order?.anthropic).toEqual(["anthropic:default"]);
  });
});
