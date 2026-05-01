import fsSync from "node:fs";
import path from "node:path";
import { resolveNotebookLmRuntimeBin } from "../../plugins/plugin-runtimes.js";

export function isNotebookLmNlmCommand(command: string): boolean {
  const trimmed = command.trim();
  return trimmed === "nlm" || trimmed.endsWith("/nlm") || trimmed.endsWith("\\nlm");
}

export function resolveNotebookLmDefaultCommand(env: NodeJS.ProcessEnv = process.env): string {
  const managed = resolveNotebookLmRuntimeBin(env);
  return fsSync.existsSync(managed) ? managed : "nlm";
}

export function resolveNotebookLmCliCommand(
  command: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const trimmed = command.trim();
  return trimmed || resolveNotebookLmDefaultCommand(env);
}

export function resolveSiblingNlmCommand(command: string): string | null {
  const trimmed = command.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return null;
  }
  const siblingNlm = path.join(path.dirname(trimmed), "nlm");
  return fsSync.existsSync(siblingNlm) ? siblingNlm : null;
}
