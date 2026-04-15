import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../../config/config.js";
import { createRunningTaskRun } from "../../tasks/task-executor.js";
import { resetTaskRegistryForTests } from "../../tasks/task-registry.js";
import { upsertAgentTaskRuntimeMetadata } from "../runtime/agent-metadata-store.js";
import { resolveSessionKeyForRequest } from "./session.js";

function makeTempStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-session-resolution-"));
  return path.join(dir, "agents", "main", "sessions", "sessions.json");
}

const tempRoots = new Set<string>();

function registerTempStorePath(storePath: string): string {
  tempRoots.add(path.resolve(storePath, "..", "..", "..", ".."));
  return storePath;
}

afterEach(() => {
  for (const root of tempRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
  resetTaskRegistryForTests({ persist: false });
  delete process.env.CRAWCLAW_STATE_DIR;
});

describe("resolveSessionKeyForRequest", () => {
  it("falls back to explicit sessionId when no routable session key can be derived", () => {
    const storePath = registerTempStorePath(makeTempStorePath());
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{}\n", "utf8");

    const cfg = {
      session: {
        store: storePath,
      },
    } as CrawClawConfig;

    const result = resolveSessionKeyForRequest({
      cfg,
      sessionId: "discover-proof-real-4",
      agentId: "main",
    });

    expect(result.sessionKey).toBe("discover-proof-real-4");
    expect(result.storePath).toBe(storePath);
  });

  it("falls back to agent task runtime metadata when session stores do not contain the session id", async () => {
    const storePath = registerTempStorePath(makeTempStorePath());
    const stateDir = path.resolve(storePath, "..", "..", "..", "..");
    process.env.CRAWCLAW_STATE_DIR = stateDir;
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    fs.writeFileSync(storePath, "{}\n", "utf8");

    const cfg = {
      session: {
        store: path.join(stateDir, "agents", "{agentId}", "sessions", "sessions.json"),
      },
    } as CrawClawConfig;
    const childSessionKey = "agent:worker:subagent:resume-child";
    const workerStorePath = path.join(stateDir, "agents", "worker", "sessions", "sessions.json");
    fs.mkdirSync(path.dirname(workerStorePath), { recursive: true });
    fs.writeFileSync(workerStorePath, "{}\n", "utf8");

    const created = createRunningTaskRun({
      runtime: "subagent",
      ownerKey: "agent:main:main",
      scopeKind: "session",
      childSessionKey,
      agentId: "worker",
      agentMetadata: {
        parentAgentId: "main",
        mode: "background",
        spawnSource: "sessions_spawn",
      },
      runId: "run-resume-child",
      task: "Resume worker child",
    });
    await upsertAgentTaskRuntimeMetadata({
      taskId: created.taskId,
      runtime: "subagent",
      agentId: "worker",
      parentAgentId: "main",
      mode: "background",
      spawnSource: "sessions_spawn",
      sessionKey: childSessionKey,
      sessionId: "resume-session-123",
      storePath: workerStorePath,
      runId: "run-resume-child",
      task: "Resume worker child",
    });

    const result = resolveSessionKeyForRequest({
      cfg,
      sessionId: "resume-session-123",
    });

    expect(result.sessionKey).toBe(childSessionKey);
    expect(result.storePath).toBe(workerStorePath);
  });
});
