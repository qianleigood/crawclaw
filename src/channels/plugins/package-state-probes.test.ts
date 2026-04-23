import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listBundledChannelIdsWithConfiguredState } from "./configured-state.js";
import {
  __testing,
  hasBundledChannelPackageState,
  listBundledChannelIdsForPackageState,
} from "./package-state-probes.js";
import { hasBundledChannelPersistedAuthState } from "./persisted-auth-state.js";

const tempDirs: string[] = [];

function makeTempStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-package-state-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  __testing.clearPackageStateProbeCache();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("package state probes", () => {
  it("lists configured-state channels from package metadata", () => {
    expect(listBundledChannelIdsWithConfiguredState()).toEqual(
      expect.arrayContaining(["discord", "irc", "slack", "telegram"]),
    );
  });

  it("runs configured-state checkers from package metadata", () => {
    expect(
      hasBundledChannelPackageState({
        metadataKey: "configuredState",
        channelId: "slack",
        cfg: {},
        env: { SLACK_BOT_TOKEN: "xoxb-test" } as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });

  it("runs persisted-auth-state checkers from package metadata", () => {
    const stateDir = makeTempStateDir();
    const authDir = path.join(stateDir, "credentials", "whatsapp", "default");
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}", "utf8");

    expect(listBundledChannelIdsForPackageState("persistedAuthState")).toEqual(
      expect.arrayContaining(["matrix", "whatsapp"]),
    );
    expect(
      hasBundledChannelPersistedAuthState({
        channelId: "whatsapp",
        cfg: {},
        env: { CRAWCLAW_STATE_DIR: stateDir } as NodeJS.ProcessEnv,
      }),
    ).toBe(true);
  });
});
