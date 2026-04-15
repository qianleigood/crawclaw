import { describe, expect, it } from "vitest";
import { newContextArchiveId, resolveContextArchiveRootDir, sha256Hex } from "./archive-id.js";

describe("context archive ids", () => {
  it("creates stable sha256 hashes", () => {
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
    expect(sha256Hex("hello")).not.toBe(sha256Hex("world"));
  });

  it("creates prefixed ids", () => {
    expect(newContextArchiveId("carun")).toMatch(/^carun_[0-9a-f-]{36}$/);
  });

  it("resolves the archive root under the state dir by default", () => {
    const root = resolveContextArchiveRootDir({ baseDir: "/tmp/crawclaw-state" });
    expect(root).toBe("/tmp/crawclaw-state/context-archive");
  });

  it("uses an explicit rootDir without appending another suffix", () => {
    const root = resolveContextArchiveRootDir({ rootDir: "/tmp/custom-archive" });
    expect(root).toBe("/tmp/custom-archive");
  });
});
