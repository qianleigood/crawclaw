import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("Pi embedded compaction architecture guardrails", () => {
  it("keeps compaction on the memory-runtime-owned path", () => {
    const compactRuntimePath = resolve(
      ROOT_DIR,
      "agents/pi-embedded-runner",
      ["compact", "runtime.ts"].join("."),
    );
    expect(existsSync(compactRuntimePath)).toBe(false);

    const compactSource = readFileSync(
      resolve(ROOT_DIR, "agents/pi-embedded-runner/compact.ts"),
      "utf8",
    );
    expect(compactSource).not.toContain(["compactEmbeddedPiSession", "Direct"].join(""));
    expect(compactSource).not.toContain(["session", "compact("].join("."));
  });
});
