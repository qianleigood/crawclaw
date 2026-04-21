import { describe, expect, it } from "vitest";
import { collectPreparedPrepackErrors, shouldSkipPrepack } from "../scripts/crawclaw-prepack.ts";

describe("shouldSkipPrepack", () => {
  it("treats unset and explicit false values as disabled", () => {
    expect(shouldSkipPrepack({})).toBe(false);
    expect(shouldSkipPrepack({ CRAWCLAW_PREPACK_PREPARED: "0" })).toBe(false);
    expect(shouldSkipPrepack({ CRAWCLAW_PREPACK_PREPARED: "0" })).toBe(false);
    expect(shouldSkipPrepack({ CRAWCLAW_PREPACK_PREPARED: "false" })).toBe(false);
    expect(shouldSkipPrepack({ CRAWCLAW_PREPACK_PREPARED: "false" })).toBe(false);
  });

  it("treats non-false values as enabled", () => {
    expect(shouldSkipPrepack({ CRAWCLAW_PREPACK_PREPARED: "1" })).toBe(true);
    expect(shouldSkipPrepack({ CRAWCLAW_PREPACK_PREPARED: "1" })).toBe(true);
    expect(shouldSkipPrepack({ CRAWCLAW_PREPACK_PREPARED: "true" })).toBe(true);
    expect(shouldSkipPrepack({ CRAWCLAW_PREPACK_PREPARED: "true" })).toBe(true);
  });
});

describe("collectPreparedPrepackErrors", () => {
  it("accepts prepared release artifacts", () => {
    expect(collectPreparedPrepackErrors(["dist/index.mjs"], [])).toEqual([]);
  });

  it("reports missing build artifacts", () => {
    expect(collectPreparedPrepackErrors([], [])).toEqual([
      "missing required prepared artifact: dist/index.js or dist/index.mjs",
    ]);
  });
});
