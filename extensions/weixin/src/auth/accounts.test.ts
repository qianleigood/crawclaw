import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_ACCOUNT_ID } from "crawclaw/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BASE_URL, listWeixinAccountIds, resolveWeixinAccount } from "./accounts.js";

describe("weixin accounts", () => {
  let stateDir: string;

  beforeEach(() => {
    stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-weixin-accounts-"));
    vi.stubEnv("CRAWCLAW_STATE_DIR", stateDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(stateDir, { recursive: true, force: true });
  });

  it("lists the default account when only the legacy token exists", () => {
    const legacyDir = path.join(stateDir, "credentials", "weixin");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "credentials.json"),
      JSON.stringify({ token: "legacy-token" }),
      "utf-8",
    );

    expect(listWeixinAccountIds({})).toEqual([DEFAULT_ACCOUNT_ID]);
  });

  it("resolves the default account from top-level channel config", () => {
    const account = resolveWeixinAccount(
      {
        channels: {
          weixin: {
            enabled: false,
            name: "Primary Weixin",
          },
        },
      },
      undefined,
    );

    expect(account.accountId).toBe(DEFAULT_ACCOUNT_ID);
    expect(account.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(account.enabled).toBe(false);
    expect(account.name).toBe("Primary Weixin");
    expect(account.configured).toBe(false);
  });
});
