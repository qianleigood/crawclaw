import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookLmConfig } from "../types/config.ts";
import {
  readExperienceOutboxEntries,
  readPendingExperienceOutboxEntries,
  upsertExperienceOutboxEntryFromNote,
} from "./outbox-store.js";

const execFileMock = vi.fn();
const previousStateDir = process.env.CRAWCLAW_STATE_DIR;
const tempDirs: string[] = [];

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

async function useTempStateDir(): Promise<string> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-experience-sync-"));
  tempDirs.push(stateDir);
  process.env.CRAWCLAW_STATE_DIR = stateDir;
  return stateDir;
}

describe("flushPendingExperienceNotes", () => {
  beforeEach(() => {
    vi.resetModules();
    execFileMock.mockReset();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    if (previousStateDir === undefined) {
      delete process.env.CRAWCLAW_STATE_DIR;
    } else {
      process.env.CRAWCLAW_STATE_DIR = previousStateDir;
    }
  });

  it("flushes pending local experience notes to NotebookLM and removes the local payload", async () => {
    await useTempStateDir();
    const { flushPendingExperienceNotes } = await import("./sync-outbox.js");
    await upsertExperienceOutboxEntryFromNote({
      note: {
        type: "procedure",
        title: "待同步网关恢复经验",
        summary: "NotebookLM 恢复后应该把本地暂存经验同步过去。",
        context: "NotebookLM 登录态曾经过期。",
        action: "恢复后批量同步 pending 经验。",
        lesson: "本地 outbox 只负责可靠暂存。",
        dedupeKey: "pending-gateway-recovery",
      },
      notebookId: "local",
      syncStatus: "pending_sync",
      syncError: "auth_expired",
      updatedAt: 1_000,
    });

    execFileMock
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            ready: true,
            profile: "default",
            notebookId: "experience-notebook",
            refreshAttempted: false,
            refreshSucceeded: false,
          }),
        );
      })
      .mockImplementationOnce((_command, _args, _options, callback) => {
        callback(
          null,
          JSON.stringify({
            status: "ok",
            action: "create",
            noteId: "note-pending-gateway",
            title: "待同步网关恢复经验",
            notebookId: "experience-notebook",
          }),
        );
      });

    const result = await flushPendingExperienceNotes({
      config: {
        enabled: true,
        auth: {
          profile: "default",
          cookieFile: "",
          statusTtlMs: 60_000,
          degradedCooldownMs: 120_000,
          refreshCooldownMs: 180_000,
          heartbeat: {
            enabled: true,
            minIntervalMs: 60_000,
            maxIntervalMs: 60_000,
          },
        },
        cli: {
          enabled: true,
          command: "python",
          args: ["/tmp/notebooklm-cli-recall.py", "{query}", "{limit}", "{notebookId}"],
          timeoutMs: 1_000,
          limit: 5,
          notebookId: "experience-notebook",
        },
        write: {
          enabled: false,
          command: "python",
          args: ["/tmp/notebooklm-cli-recall.py", "write", "{payloadFile}", "{notebookId}"],
          timeoutMs: 1_000,
          notebookId: "experience-notebook",
        } as unknown as NotebookLmConfig["write"],
      },
    });

    expect(result).toMatchObject({
      status: "ok",
      scanned: 1,
      synced: 1,
      failed: 0,
      skipped: false,
    });
    expect(await readPendingExperienceOutboxEntries(10)).toEqual([]);
    expect(await readExperienceOutboxEntries(10)).toEqual([]);
  });
});
