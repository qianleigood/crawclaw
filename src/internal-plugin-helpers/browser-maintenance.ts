import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommandWithTimeout } from "../process/exec.js";

export type BrowserSessionCleanupParams = {
  sessionKeys: Array<string | undefined>;
  onWarn?: (message: string) => void;
};

function createTrashCollisionSuffix(): string {
  return randomBytes(6).toString("hex");
}

export async function closeTrackedBrowserTabsForSessions(
  _params: BrowserSessionCleanupParams,
): Promise<number> {
  return 0;
}

export async function movePathToTrash(targetPath: string): Promise<string> {
  try {
    const result = await runCommandWithTimeout(["trash", targetPath], { timeoutMs: 10_000 });
    if (result.code !== 0) {
      throw new Error(`trash exited with code ${result.code ?? "unknown"}`);
    }
    return targetPath;
  } catch {
    const homeDir = os.homedir();
    const pathRuntime = homeDir.startsWith("/") ? path.posix : path;
    const trashDir = pathRuntime.join(homeDir, ".Trash");
    await fs.mkdir(trashDir, { recursive: true });
    const base = pathRuntime.basename(targetPath);
    const timestamp = Date.now();
    let destination = pathRuntime.join(trashDir, `${base}-${timestamp}`);
    try {
      await fs.access(destination);
      destination = pathRuntime.join(
        trashDir,
        `${base}-${timestamp}-${createTrashCollisionSuffix()}`,
      );
    } catch {
      // The initial destination is free to use.
    }
    await fs.rename(targetPath, destination);
    return destination;
  }
}
