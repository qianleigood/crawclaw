import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORE_VERSION } from "./auth-profiles/constants.js";

let clearRuntimeAuthProfileStoreSnapshots: typeof import("./auth-profiles.js").clearRuntimeAuthProfileStoreSnapshots;
let ensureAuthProfileStore: typeof import("./auth-profiles.js").ensureAuthProfileStore;

async function loadFreshAuthProfilesModuleForTest() {
  vi.resetModules();
  ({ clearRuntimeAuthProfileStoreSnapshots, ensureAuthProfileStore } =
    await import("./auth-profiles.js"));
}

function withAgentDirEnv(prefix: string, run: (agentDir: string) => void | Promise<void>) {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const previousAgentDir = process.env.CRAWCLAW_AGENT_DIR;
  const previousPiAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.CRAWCLAW_AGENT_DIR = agentDir;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    return run(agentDir);
  } finally {
    if (previousAgentDir === undefined) {
      delete process.env.CRAWCLAW_AGENT_DIR;
    } else {
      process.env.CRAWCLAW_AGENT_DIR = previousAgentDir;
    }
    if (previousPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiAgentDir;
    }
    fs.rmSync(agentDir, { recursive: true, force: true });
  }
}

function writeAuthStore(agentDir: string, key: string) {
  const authPath = path.join(agentDir, "auth-profiles.json");
  fs.writeFileSync(
    authPath,
    `${JSON.stringify(
      {
        version: AUTH_STORE_VERSION,
        profiles: {
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key,
          },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return authPath;
}

describe("auth profile store cache", () => {
  beforeEach(async () => {
    await loadFreshAuthProfilesModuleForTest();
  });

  afterEach(() => {
    clearRuntimeAuthProfileStoreSnapshots();
  });

  it("reuses the auth store while auth-profiles.json is unchanged", async () => {
    await withAgentDirEnv("crawclaw-auth-store-cache-", (agentDir) => {
      writeAuthStore(agentDir, "sk-test");

      ensureAuthProfileStore(agentDir);
      ensureAuthProfileStore(agentDir);

      expect(fs.existsSync(path.join(agentDir, "auth-profiles.json"))).toBe(true);
    });
  });

  it("refreshes the cached auth store after auth-profiles.json changes", async () => {
    await withAgentDirEnv("crawclaw-auth-store-refresh-", async (agentDir) => {
      const authPath = writeAuthStore(agentDir, "sk-test-1");

      ensureAuthProfileStore(agentDir);

      writeAuthStore(agentDir, "sk-test-2");
      const bumpedMtime = new Date(Date.now() + 2_000);
      fs.utimesSync(authPath, bumpedMtime, bumpedMtime);

      const reloaded = ensureAuthProfileStore(agentDir);

      expect(reloaded.profiles["openai:default"]).toMatchObject({
        key: "sk-test-2",
      });
    });
  });
});
