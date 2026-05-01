import { execFile as execFileCallback } from "node:child_process";
import type { NotebookLmConfig } from "../types/config.ts";
import {
  isNotebookLmNlmCommand,
  resolveNotebookLmCliCommand,
  resolveNotebookLmDefaultCommand,
  resolveSiblingNlmCommand,
} from "./command.js";

const DEFAULT_NOTEBOOK_TITLE = "CrawClaw";

export interface NotebookLmNotebook {
  id: string;
  title: string;
  sourceCount?: number;
}

export interface NotebookLmNotebookSetupResult {
  status: "selected" | "created";
  notebookId: string;
  title: string;
  profile: string;
  sourceCount: number;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error === "number" || typeof error === "boolean" || typeof error === "bigint") {
    return `${error}`;
  }
  if (typeof error === "symbol") {
    return error.description ? `Symbol(${error.description})` : "Symbol()";
  }
  try {
    const serialized = JSON.stringify(error);
    return typeof serialized === "string" ? serialized : "Unknown error";
  } catch {
    return "Unknown error";
  }
}

function normalizeTitle(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function resolveProfile(config: NotebookLmConfig): string {
  return (config.auth.profile || "default").trim() || "default";
}

function profileArgs(profile: string): string[] {
  return profile === "default" ? [] : ["--profile", profile];
}

function resolveSetupNlmCommand(config: NotebookLmConfig): string {
  const configured = config.cli.command.trim();
  if (configured) {
    const sibling = resolveSiblingNlmCommand(configured);
    if (sibling) {
      return sibling;
    }
    const resolved = resolveNotebookLmCliCommand(configured);
    if (isNotebookLmNlmCommand(resolved)) {
      return resolved;
    }
  }
  return resolveNotebookLmDefaultCommand();
}

async function execNotebookLmNotebookCommand(
  config: NotebookLmConfig,
  args: string[],
): Promise<string> {
  const command = resolveSetupNlmCommand(config);
  return await new Promise<string>((resolve, reject) => {
    execFileCallback(
      command,
      args,
      {
        timeout: Math.max(config.cli.timeoutMs || 0, 30_000),
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          ...(config.auth.cookieFile?.trim()
            ? { CRAWCLAW_NOTEBOOKLM_COOKIE_FILE: config.auth.cookieFile.trim() }
            : {}),
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = [formatUnknownError(error), stdout, stderr]
            .filter((part) => typeof part === "string" && part.trim().length)
            .join("\n");
          reject(new Error(detail));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function isTransientNotebookLmApiError(error: unknown): boolean {
  const message = formatUnknownError(error);
  return /API error \(code 7\)|google\.rpc\.ErrorInfo/i.test(message);
}

async function execNotebookLmNotebookCommandWithRetry(
  config: NotebookLmConfig,
  args: string[],
): Promise<string> {
  try {
    return await execNotebookLmNotebookCommand(config, args);
  } catch (error) {
    if (!isTransientNotebookLmApiError(error)) {
      throw error;
    }
    return await execNotebookLmNotebookCommand(config, args);
  }
}

function readNotebookListPayload(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  const record = asRecord(parsed);
  for (const key of ["notebooks", "results", "items"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function mapNotebook(value: unknown): NotebookLmNotebook | null {
  const record = asRecord(value);
  const id = readString(record.id) ?? readString(record.notebookId);
  const title = readString(record.title) ?? readString(record.name);
  if (!id || !title) {
    return null;
  }
  return {
    id,
    title,
    sourceCount: readNumber(record.source_count) ?? readNumber(record.sourceCount),
  };
}

function parseNotebookList(stdout: string): NotebookLmNotebook[] {
  const parsed = JSON.parse(stdout) as unknown;
  return readNotebookListPayload(parsed)
    .map(mapNotebook)
    .filter((entry): entry is NotebookLmNotebook => Boolean(entry));
}

function parseCreatedNotebookId(stdout: string): string {
  const id = stdout.match(/^\s*ID:\s*(\S+)\s*$/im)?.[1]?.trim();
  if (!id) {
    throw new Error("NotebookLM notebook was created, but the CLI did not return an ID.");
  }
  return id;
}

export async function ensureNotebookLmNotebook(params: {
  config: NotebookLmConfig;
  title?: string;
  create?: boolean;
}): Promise<NotebookLmNotebookSetupResult> {
  const title = readString(params.title) ?? DEFAULT_NOTEBOOK_TITLE;
  const profile = resolveProfile(params.config);
  const listStdout = await execNotebookLmNotebookCommandWithRetry(params.config, [
    "notebook",
    "list",
    "--json",
    ...profileArgs(profile),
  ]);
  const existing = parseNotebookList(listStdout).find(
    (entry) => normalizeTitle(entry.title) === normalizeTitle(title),
  );
  if (existing) {
    return {
      status: "selected",
      notebookId: existing.id,
      title: existing.title,
      profile,
      sourceCount: existing.sourceCount ?? 0,
    };
  }
  if (params.create === false) {
    throw new Error(`NotebookLM notebook "${title}" was not found.`);
  }
  const createStdout = await execNotebookLmNotebookCommandWithRetry(params.config, [
    "notebook",
    "create",
    title,
    ...profileArgs(profile),
  ]);
  return {
    status: "created",
    notebookId: parseCreatedNotebookId(createStdout),
    title,
    profile,
    sourceCount: 0,
  };
}
