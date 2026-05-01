import { execFile as execFileCallback } from "node:child_process";
import type { NotebookLmConfig } from "../types/config.ts";
import { resolveNotebookLmDefaultCommand, resolveSiblingNlmCommand } from "./command.js";

export function inferNotebookLmLoginCommand(
  cfg: NotebookLmConfig,
): { command: string; args: string[] } | null {
  const trimmed = cfg.cli.command.trim();
  const profile = (cfg.auth.profile || "default").trim() || "default";
  if (trimmed) {
    const siblingNlm = resolveSiblingNlmCommand(trimmed);
    if (siblingNlm) {
      return {
        command: siblingNlm,
        args: profile === "default" ? ["login"] : ["login", "--profile", profile],
      };
    }
  }
  return {
    command: resolveNotebookLmDefaultCommand(),
    args: profile === "default" ? ["login"] : ["login", "--profile", profile],
  };
}

export function inferNotebookLmAutoLoginCommand(
  cfg: NotebookLmConfig,
): { command: string; args: string[] } | null {
  const base = inferNotebookLmLoginCommand(cfg);
  if (!base) {
    return null;
  }
  const profile = (cfg.auth.profile || "default").trim() || "default";
  const autoLogin = cfg.auth.autoLogin;
  if (autoLogin?.provider === "openclaw_cdp") {
    const cdpUrl = autoLogin.cdpUrl?.trim();
    if (!cdpUrl) {
      return null;
    }
    return {
      command: base.command,
      args: [
        "login",
        "--provider",
        "openclaw",
        "--cdp-url",
        cdpUrl,
        ...(profile === "default" ? [] : ["--profile", profile]),
      ],
    };
  }
  return base;
}

export async function runNotebookLmLoginCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFileCallback(
      command,
      args,
      { env: process.env, timeout: 10 * 60_000, maxBuffer: 1024 * 1024 },
      (error) => {
        if (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            reject(
              new Error(
                `NotebookLM CLI "${command}" was not found. Run "crawclaw runtimes install" to install the managed notebooklm-mcp-cli runtime, install notebooklm-mcp-cli so "nlm" is on PATH, or configure memory.notebooklm.cli.command.`,
              ),
            );
            return;
          }
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}
