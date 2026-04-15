import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNonExitingRuntime } from "../runtime.js";
import { migrateCrawClawCommand } from "./migrate-legacy-state.js";

let tempRoot: string | null = null;

async function makeTempRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-migrate-crawclaw-"));
  tempRoot = root;
  return root;
}

afterEach(async () => {
  if (!tempRoot) {
    return;
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("migrateCrawClawCommand", () => {
  it("moves legacy state into .crawclaw and renames the config file", async () => {
    const root = await makeTempRoot();
    const legacyDir = path.join(root, ".crawclaw");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, "crawclaw.json"), "{}", "utf-8");
    await fs.writeFile(path.join(legacyDir, "marker.txt"), "ok", "utf-8");

    const runtime = createNonExitingRuntime();
    vi.spyOn(runtime, "log").mockImplementation(() => {});
    vi.spyOn(runtime, "error").mockImplementation(() => {});

    await migrateCrawClawCommand({}, runtime, {
      env: { HOME: root } as NodeJS.ProcessEnv,
      homedir: () => root,
    });

    const newDir = path.join(root, ".crawclaw");
    expect(await fs.readFile(path.join(newDir, "crawclaw.json"), "utf-8")).toBe("{}");
    expect(await fs.readFile(path.join(newDir, "marker.txt"), "utf-8")).toBe("ok");
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Migration changes:"));
  });

  it("supports dry-run without mutating files", async () => {
    const root = await makeTempRoot();
    const legacyDir = path.join(root, ".crawclaw");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.writeFile(path.join(legacyDir, "crawclaw.json"), "{}", "utf-8");

    const runtime = createNonExitingRuntime();
    vi.spyOn(runtime, "log").mockImplementation(() => {});
    vi.spyOn(runtime, "error").mockImplementation(() => {});

    await migrateCrawClawCommand({ dryRun: true }, runtime, {
      env: { HOME: root } as NodeJS.ProcessEnv,
      homedir: () => root,
    });

    await expect(fs.access(path.join(root, ".crawclaw", "crawclaw.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, ".crawclaw", "crawclaw.json"))).rejects.toThrow();
    expect(runtime.log).toHaveBeenCalledWith(
      expect.stringContaining("[dry-run] State dir:"),
    );
  });

  it("refuses to run when runtime path overrides are set", async () => {
    const root = await makeTempRoot();
    const runtime = createNonExitingRuntime();
    vi.spyOn(runtime, "log").mockImplementation(() => {});
    vi.spyOn(runtime, "error").mockImplementation(() => {});

    await expect(
      migrateCrawClawCommand({}, runtime, {
        env: {
          HOME: root,
          CRAWCLAW_STATE_DIR: path.join(root, "custom-state"),
        } as NodeJS.ProcessEnv,
        homedir: () => root,
      }),
    ).rejects.toThrow("exit 1");

    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("Migration expects default CrawClaw runtime paths."),
    );
  });

  it("also refuses to run when legacy CrawClaw overrides are still set", async () => {
    const root = await makeTempRoot();
    const runtime = createNonExitingRuntime();
    vi.spyOn(runtime, "log").mockImplementation(() => {});
    vi.spyOn(runtime, "error").mockImplementation(() => {});

    await expect(
      migrateCrawClawCommand({}, runtime, {
        env: {
          HOME: root,
          CRAWCLAW_STATE_DIR: path.join(root, "legacy-custom-state"),
        } as NodeJS.ProcessEnv,
        homedir: () => root,
      }),
    ).rejects.toThrow("exit 1");

    expect(runtime.error).toHaveBeenCalledWith(
      expect.stringContaining("Unset CRAWCLAW_STATE_DIR and rerun crawclaw migrate-crawclaw."),
    );
  });
});
