import { execFile as execFileCallback } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import type { NotebookLmConfig } from "../types/config.ts";

export function inferNotebookLmLoginCommand(
  cfg: NotebookLmConfig,
): { command: string; args: string[] } | null {
  const trimmed = cfg.cli.command.trim();
  if (!trimmed) {
    return null;
  }
  const profile = (cfg.auth.profile || "default").trim() || "default";
  const siblingNlm = path.join(path.dirname(trimmed), "nlm");
  if (path.isAbsolute(trimmed) && fsSync.existsSync(siblingNlm)) {
    return {
      command: siblingNlm,
      args: profile === "default" ? ["login"] : ["login", "--profile", profile],
    };
  }
  return {
    command: "nlm",
    args: profile === "default" ? ["login"] : ["login", "--profile", profile],
  };
}

export async function runNotebookLmLoginCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFileCallback(
      command,
      args,
      { env: process.env, timeout: 10 * 60_000, maxBuffer: 1024 * 1024 },
      (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}
