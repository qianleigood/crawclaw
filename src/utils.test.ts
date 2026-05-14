import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assertWebChannel,
  ensureDir,
  normalizeE164,
  resolveConfigDir,
  resolveHomeDir,
  resolveUserPath,
  shortenHomeInString,
  shortenHomePath,
  sleep,
} from "./utils.js";

async function withTempDir<T>(
  prefix: string,
  run: (dir: string) => T | Promise<T>,
): Promise<Awaited<T>> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("ensureDir", () => {
  it("creates nested directory", async () => {
    await withTempDir("crawclaw-test-", async (tmp) => {
      const target = path.join(tmp, "nested", "dir");
      await ensureDir(target);
      expect(fs.existsSync(target)).toBe(true);
    });
  });
});

describe("sleep", () => {
  it("resolves after delay using fake timers", async () => {
    vi.useFakeTimers();
    const promise = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe("assertWebChannel", () => {
  it("accepts valid channel", () => {
    expect(() => assertWebChannel("web")).not.toThrow();
  });

  it("throws for invalid channel", () => {
    expect(() => assertWebChannel("bad" as string)).toThrow();
  });
});

describe("normalizeE164", () => {
  it("strips formatting and prefixes", () => {
    expect(normalizeE164("feishu:(555) 123-4567")).toBe("+5551234567");
    expect(normalizeE164("+555 123 4567")).toBe("+5551234567");
  });
});

describe("resolveConfigDir", () => {
  it("prefers ~/.crawclaw when no legacy dir exists", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "crawclaw-config-dir-"));
    try {
      const newDir = path.join(root, ".crawclaw");
      await fs.promises.mkdir(newDir, { recursive: true });
      const resolved = resolveConfigDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });

  it("expands CRAWCLAW_STATE_DIR using the provided env", () => {
    const env = {
      HOME: "/tmp/crawclaw-home",
      CRAWCLAW_STATE_DIR: "~/state",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/crawclaw-home", "state"));
  });

  it("uses CRAWCLAW_STATE_DIR when it is set", () => {
    const env = {
      HOME: "/tmp/crawclaw-home",
      CRAWCLAW_STATE_DIR: "~/state",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/crawclaw-home", "state"));
  });
});

describe("resolveHomeDir", () => {
  it("prefers CRAWCLAW_HOME over CRAWCLAW_HOME and HOME", () => {
    vi.stubEnv("CRAWCLAW_HOME", "/srv/crawclaw-home");
    vi.stubEnv("CRAWCLAW_HOME", "/srv/crawclaw-home");
    vi.stubEnv("HOME", "/home/other");

    expect(resolveHomeDir()).toBe(path.resolve("/srv/crawclaw-home"));

    vi.unstubAllEnvs();
  });
});

describe("shortenHomePath", () => {
  it("uses $CRAWCLAW_HOME prefix when CRAWCLAW_HOME is set", () => {
    vi.stubEnv("CRAWCLAW_HOME", "/srv/crawclaw-home");
    vi.stubEnv("HOME", "/home/other");

    expect(shortenHomePath(`${path.resolve("/srv/crawclaw-home")}/.crawclaw/crawclaw.json`)).toBe(
      "$CRAWCLAW_HOME/.crawclaw/crawclaw.json",
    );

    vi.unstubAllEnvs();
  });
});

describe("shortenHomeInString", () => {
  it("uses $CRAWCLAW_HOME replacement when CRAWCLAW_HOME is set", () => {
    vi.stubEnv("CRAWCLAW_HOME", "/srv/crawclaw-home");
    vi.stubEnv("HOME", "/home/other");

    expect(
      shortenHomeInString(`config: ${path.resolve("/srv/crawclaw-home")}/.crawclaw/crawclaw.json`),
    ).toBe("config: $CRAWCLAW_HOME/.crawclaw/crawclaw.json");

    vi.unstubAllEnvs();
  });
});

describe("resolveUserPath", () => {
  it("expands ~ to home dir", () => {
    expect(resolveUserPath("~", {}, () => "/Users/thoffman")).toBe(path.resolve("/Users/thoffman"));
  });

  it("expands ~/ to home dir", () => {
    expect(resolveUserPath("~/crawclaw", {}, () => "/Users/thoffman")).toBe(
      path.resolve("/Users/thoffman", "crawclaw"),
    );
  });

  it("resolves relative paths", () => {
    expect(resolveUserPath("tmp/dir")).toBe(path.resolve("tmp/dir"));
  });

  it("prefers CRAWCLAW_HOME for tilde expansion", () => {
    vi.stubEnv("CRAWCLAW_HOME", "/srv/crawclaw-home");
    vi.stubEnv("HOME", "/home/other");

    expect(resolveUserPath("~/crawclaw")).toBe(path.resolve("/srv/crawclaw-home", "crawclaw"));

    vi.unstubAllEnvs();
  });

  it("uses the provided env for tilde expansion", () => {
    const env = {
      HOME: "/tmp/crawclaw-home",
      CRAWCLAW_HOME: "/srv/crawclaw-home",
    } as NodeJS.ProcessEnv;

    expect(resolveUserPath("~/crawclaw", env)).toBe(path.resolve("/srv/crawclaw-home", "crawclaw"));
  });

  it("keeps blank paths blank", () => {
    expect(resolveUserPath("")).toBe("");
    expect(resolveUserPath("   ")).toBe("");
  });

  it("returns empty string for undefined/null input", () => {
    expect(resolveUserPath(undefined as unknown as string)).toBe("");
    expect(resolveUserPath(null as unknown as string)).toBe("");
  });
});
