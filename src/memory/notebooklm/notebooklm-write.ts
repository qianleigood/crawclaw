import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getSharedMemoryPromptJournal } from "../diagnostics/prompt-journal.ts";
import {
  classifyExperienceNoteGuardIssue,
  renderExperienceNoteMarkdown,
  type ExperienceNoteWriteInput,
} from "../experience/note.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import { resolveNotebookLmDefaultCommand } from "./command.js";
import { emitNotebookLmNotification } from "./notification.ts";
import { getNotebookLmProviderState } from "./provider-state.ts";

type RuntimeLogger = { warn(message: string): void };

export interface NotebookLmExperienceWriteResult {
  status: "ok" | "missing";
  action?: "create" | "update" | "upsert";
  noteId?: string;
  title: string;
  notebookId: string;
  payloadFile: string;
  raw?: unknown;
}

export interface NotebookLmExperienceDeleteResult {
  status: "ok" | "missing";
  action?: "delete";
  noteId: string;
  notebookId: string;
  raw?: unknown;
}

type RawNotebookLmWriteResponse = {
  status?: string;
  action?: string;
  noteId?: string;
  id?: string;
  title?: string;
  notebookId?: string;
  message?: string;
  raw?: unknown;
};

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

function renderTemplate(
  value: string,
  params: { payloadFile: string; notebookId: string; title: string; type: string },
): string {
  return value
    .replaceAll("{payloadFile}", params.payloadFile)
    .replaceAll("{notebookId}", params.notebookId)
    .replaceAll("{title}", params.title)
    .replaceAll("{type}", params.type);
}

function normalizeWriteResponse(value: unknown): RawNotebookLmWriteResponse {
  if (!value || typeof value !== "object") {
    return { status: "ok", raw: value };
  }
  const record = value as Record<string, unknown>;
  const action = typeof record.action === "string" ? record.action : undefined;
  const status = typeof record.status === "string" ? record.status : undefined;
  const noteId =
    typeof record.noteId === "string"
      ? record.noteId
      : typeof record.id === "string"
        ? record.id
        : undefined;
  return {
    status: status ?? "ok",
    action: action === "create" || action === "update" || action === "upsert" ? action : undefined,
    noteId,
    title: typeof record.title === "string" ? record.title : undefined,
    notebookId: typeof record.notebookId === "string" ? record.notebookId : undefined,
    message: typeof record.message === "string" ? record.message : undefined,
    raw: value,
  };
}

function resolveProfile(config: NotebookLmConfig): string {
  return (config.auth.profile || "default").trim() || "default";
}

function profileArgs(profile: string): string[] {
  return profile === "default" ? [] : ["--profile", profile];
}

function parseNativeNoteCreateResponse(stdout: string): RawNotebookLmWriteResponse {
  const noteId = stdout.match(/Note created:\s*(\S+)/i)?.[1]?.trim();
  const title = stdout.match(/^\s*Title:\s*(.+?)\s*$/im)?.[1]?.trim();
  return {
    status: "ok",
    action: "create",
    noteId,
    title,
    raw: stdout,
  };
}

function isTransientNotebookLmApiError(message: string): boolean {
  return /API error \(code 7\)|google\.rpc\.ErrorInfo/i.test(message);
}

async function waitForNotebookLmRetry(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, attempt * 500));
}

async function execNotebookLmWriteCommand(params: {
  command: string;
  args: string[];
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await new Promise<string>((resolve, reject) => {
        execFileCallback(
          params.command,
          params.args,
          {
            timeout: params.timeoutMs,
            maxBuffer: 1024 * 1024,
            env: {
              ...process.env,
              ...params.env,
            },
          },
          (error, nextStdout, nextStderr) => {
            if (error) {
              const detail = [formatUnknownError(error), nextStdout, nextStderr]
                .filter((part) => typeof part === "string" && part.trim().length > 0)
                .join("\n");
              reject(new Error(detail));
              return;
            }
            resolve(nextStdout);
          },
        );
      });
    } catch (error) {
      const message = formatUnknownError(error);
      if (attempt < maxAttempts && isTransientNotebookLmApiError(message)) {
        await waitForNotebookLmRetry(attempt);
        continue;
      }
      throw error;
    }
  }
  throw new Error("NotebookLM write command failed");
}

async function createPayloadFile(payload: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-notebooklm-write-"));
  const filePath = path.join(dir, "payload.json");
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
  return filePath;
}

export async function writeNotebookLmExperienceNoteViaCli(params: {
  config?: NotebookLmConfig;
  note: ExperienceNoteWriteInput;
  logger?: RuntimeLogger;
  notificationScope?: {
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
}): Promise<NotebookLmExperienceWriteResult | null> {
  const writeConfig = params.config?.write;
  if (!params.config?.enabled || !writeConfig) {
    return null;
  }

  const state = await getNotebookLmProviderState({
    config: params.config,
    mode: "write",
    logger: params.logger,
  });
  if (!state.ready) {
    if (params.logger) {
      emitNotebookLmNotification({
        state,
        logger: params.logger,
        scope: {
          source: "write",
          agentId: params.notificationScope?.agentId,
          channel: params.notificationScope?.channel,
          userId: params.notificationScope?.userId,
        },
      });
    }
    const message = `NotebookLM provider not ready: ${state.reason ?? "unknown"}${state.details ? ` | ${state.details}` : ""}`;
    getSharedMemoryPromptJournal()?.recordStage("experience_write", {
      agentId: params.notificationScope?.agentId ?? undefined,
      channel: params.notificationScope?.channel ?? undefined,
      userId: params.notificationScope?.userId ?? undefined,
      payload: {
        status: "provider_not_ready",
        title: params.note.title,
        noteType: params.note.type,
        summary: params.note.summary,
        reason: state.reason ?? "unknown",
        details: state.details ?? null,
      },
    });
    params.logger?.warn(`[memory] notebooklm note write skipped | ${message}`);
    throw new Error(message);
  }
  const notebookId =
    state.notebookId ?? (writeConfig.notebookId || params.config.cli.notebookId || "").trim();

  const guardIssue = classifyExperienceNoteGuardIssue(params.note);
  if (guardIssue) {
    getSharedMemoryPromptJournal()?.recordStage("experience_write", {
      agentId: params.notificationScope?.agentId ?? undefined,
      channel: params.notificationScope?.channel ?? undefined,
      userId: params.notificationScope?.userId ?? undefined,
      payload: {
        status: "guard_rejected",
        title: params.note.title,
        noteType: params.note.type,
        summary: params.note.summary,
        guardIssue,
      },
    });
    throw new Error(guardIssue);
  }

  const content = renderExperienceNoteMarkdown(params.note);
  const payload = {
    notebookId,
    title: params.note.title.trim(),
    content,
    type: params.note.type,
    summary: params.note.summary.trim(),
    dedupeKey: params.note.dedupeKey?.trim() || undefined,
    aliases: params.note.aliases ?? [],
    tags: params.note.tags ?? [],
  };
  const payloadFile = await createPayloadFile(payload);
  const args = writeConfig.args.map((value) =>
    renderTemplate(value, {
      payloadFile,
      notebookId,
      title: params.note.title.trim(),
      type: params.note.type,
    }),
  );

  try {
    const stdout = writeConfig.command.trim()
      ? await execNotebookLmWriteCommand({
          command: writeConfig.command,
          args,
          timeoutMs: writeConfig.timeoutMs,
          env: {
            NOTEBOOKLM_NOTEBOOK_ID: notebookId,
            NOTEBOOKLM_NOTE_PAYLOAD_FILE: payloadFile,
            NOTEBOOKLM_NOTE_TITLE: params.note.title.trim(),
            NOTEBOOKLM_NOTE_TYPE: params.note.type,
            NOTEBOOKLM_NOTE_DEDUPE_KEY: params.note.dedupeKey?.trim() ?? "",
          },
        })
      : await execNotebookLmWriteCommand({
          command: resolveNotebookLmDefaultCommand(),
          args: [
            "note",
            "create",
            notebookId,
            "--content",
            content,
            "--title",
            params.note.title.trim(),
            ...profileArgs(resolveProfile(params.config)),
          ],
          timeoutMs: writeConfig.timeoutMs,
          env: {
            NOTEBOOKLM_NOTEBOOK_ID: notebookId,
            NOTEBOOKLM_NOTE_TITLE: params.note.title.trim(),
            NOTEBOOKLM_NOTE_TYPE: params.note.type,
            NOTEBOOKLM_NOTE_DEDUPE_KEY: params.note.dedupeKey?.trim() ?? "",
          },
        });
    const parsed = writeConfig.command.trim()
      ? JSON.parse(stdout)
      : parseNativeNoteCreateResponse(stdout);
    const normalized = normalizeWriteResponse(parsed);
    const action =
      normalized.action === "create" ||
      normalized.action === "update" ||
      normalized.action === "upsert"
        ? normalized.action
        : undefined;
    const status: NotebookLmExperienceWriteResult["status"] =
      normalized.status === "missing" ? "missing" : "ok";
    const result: NotebookLmExperienceWriteResult = {
      status,
      action,
      noteId: normalized.noteId,
      title: normalized.title ?? params.note.title.trim(),
      notebookId: normalized.notebookId ?? notebookId,
      payloadFile,
      raw: normalized.raw,
    };
    getSharedMemoryPromptJournal()?.recordStage("experience_write", {
      agentId: params.notificationScope?.agentId ?? undefined,
      channel: params.notificationScope?.channel ?? undefined,
      userId: params.notificationScope?.userId ?? undefined,
      payload: {
        status: result.status,
        action: result.action ?? null,
        noteId: result.noteId ?? null,
        notebookId: result.notebookId,
        title: result.title,
        noteType: params.note.type,
        summary: params.note.summary,
        dedupeKey: params.note.dedupeKey ?? null,
      },
    });
    return result;
  } catch (error) {
    getSharedMemoryPromptJournal()?.recordStage("experience_write", {
      agentId: params.notificationScope?.agentId ?? undefined,
      channel: params.notificationScope?.channel ?? undefined,
      userId: params.notificationScope?.userId ?? undefined,
      payload: {
        status: "error",
        title: params.note.title,
        noteType: params.note.type,
        summary: params.note.summary,
        error: formatUnknownError(error),
      },
    });
    params.logger?.warn(`[memory] notebooklm note write skipped | ${formatUnknownError(error)}`);
    throw error;
  }
}

export async function deleteNotebookLmExperienceNoteViaCli(params: {
  config?: NotebookLmConfig;
  notebookId: string;
  noteId: string;
  logger?: RuntimeLogger;
  notificationScope?: {
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
}): Promise<NotebookLmExperienceDeleteResult | null> {
  const writeConfig = params.config?.write;
  if (!params.config?.enabled || !writeConfig) {
    return null;
  }

  const state = await getNotebookLmProviderState({
    config: params.config,
    mode: "write",
    logger: params.logger,
  });
  if (!state.ready) {
    if (params.logger) {
      emitNotebookLmNotification({
        state,
        logger: params.logger,
        scope: {
          source: "write",
          agentId: params.notificationScope?.agentId,
          channel: params.notificationScope?.channel,
          userId: params.notificationScope?.userId,
        },
      });
    }
    const message = `NotebookLM provider not ready: ${state.reason ?? "unknown"}${state.details ? ` | ${state.details}` : ""}`;
    params.logger?.warn(`[memory] notebooklm note delete skipped | ${message}`);
    throw new Error(message);
  }

  try {
    const stdout = writeConfig.command.trim()
      ? await execNotebookLmWriteCommand({
          command: writeConfig.command,
          args: [
            "delete",
            params.noteId.trim(),
            params.notebookId.trim(),
            params.config?.auth.profile ?? "default",
          ],
          timeoutMs: writeConfig.timeoutMs,
          env: {
            NOTEBOOKLM_NOTEBOOK_ID: params.notebookId.trim(),
            NOTEBOOKLM_NOTE_ID: params.noteId.trim(),
          },
        })
      : await execNotebookLmWriteCommand({
          command: resolveNotebookLmDefaultCommand(),
          args: [
            "note",
            "delete",
            params.notebookId.trim(),
            params.noteId.trim(),
            "--confirm",
            ...profileArgs(resolveProfile(params.config)),
          ],
          timeoutMs: writeConfig.timeoutMs,
          env: {
            NOTEBOOKLM_NOTEBOOK_ID: params.notebookId.trim(),
            NOTEBOOKLM_NOTE_ID: params.noteId.trim(),
          },
        });

    const parsed = writeConfig.command.trim()
      ? normalizeWriteResponse(JSON.parse(stdout))
      : ({ notebookId: params.notebookId.trim() } as RawNotebookLmWriteResponse);
    return {
      status: parsed.status === "missing" ? "missing" : "ok",
      action: "delete",
      noteId: params.noteId.trim(),
      notebookId: parsed.notebookId ?? params.notebookId.trim(),
      raw: parsed.raw,
    };
  } catch (error) {
    params.logger?.warn(`[memory] notebooklm note delete skipped | ${formatUnknownError(error)}`);
    throw error;
  }
}
