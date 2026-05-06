import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNotebookLmRuntimeBin } from "../../plugins/plugin-runtimes.ts";
import { normalizeNotebookLmConfig } from "../config/notebooklm.ts";
import {
  inferNotebookLmAutoLoginCommand,
  inferNotebookLmLoginCommand,
  runNotebookLmLoginCommand,
} from "./login.ts";

const tempRoots: string[] = [];
const originalStateDir = process.env.CRAWCLAW_STATE_DIR;

function makeManagedNlmBin(): { stateDir: string; binPath: string } {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-notebooklm-login-"));
  tempRoots.push(stateDir);
  const binPath = resolveNotebookLmRuntimeBin({ CRAWCLAW_STATE_DIR: stateDir });
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath, "", "utf8");
  process.env.CRAWCLAW_STATE_DIR = stateDir;
  return { stateDir, binPath };
}

afterEach(() => {
  if (originalStateDir === undefined) {
    delete process.env.CRAWCLAW_STATE_DIR;
  } else {
    process.env.CRAWCLAW_STATE_DIR = originalStateDir;
  }
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("NotebookLM login command inference", () => {
  it("defaults to nlm login when NotebookLM is enabled without a query command", () => {
    const config = normalizeNotebookLmConfig({ enabled: true });

    expect(inferNotebookLmLoginCommand(config)).toEqual({
      command: "nlm",
      args: ["login"],
    });
  });

  it("uses the managed notebooklm-mcp-cli runtime when it is installed", () => {
    const { binPath } = makeManagedNlmBin();
    const config = normalizeNotebookLmConfig({ enabled: true });

    expect(inferNotebookLmLoginCommand(config)).toEqual({
      command: binPath,
      args: ["login"],
    });
  });

  it("builds an OpenClaw CDP auto login command when configured", () => {
    const config = normalizeNotebookLmConfig({
      enabled: true,
      auth: {
        profile: "work",
        autoLogin: {
          enabled: true,
          provider: "openclaw_cdp",
          cdpUrl: "http://127.0.0.1:18800",
        },
      },
    });

    expect(inferNotebookLmAutoLoginCommand(config)).toEqual({
      command: "nlm",
      args: [
        "login",
        "--provider",
        "openclaw",
        "--cdp-url",
        "http://127.0.0.1:18800",
        "--profile",
        "work",
      ],
    });
  });

  it("reports a clear setup error when the login binary is missing", async () => {
    await expect(runNotebookLmLoginCommand("__crawclaw_missing_nlm__", [])).rejects.toThrow(
      'NotebookLM CLI "__crawclaw_missing_nlm__" was not found',
    );
  });
});
