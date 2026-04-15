import { describe, expect, it } from "vitest";
import { normalizePackageTagInput } from "./package-tag.js";

describe("normalizePackageTagInput", () => {
  const packageNames = ["crawclaw", "@crawclaw/plugin"] as const;

  it.each([
    { input: undefined, expected: null },
    { input: "   ", expected: null },
    { input: "crawclaw@beta", expected: "beta" },
    { input: "@crawclaw/plugin@2026.2.24", expected: "2026.2.24" },
    { input: "crawclaw@   ", expected: null },
    { input: "crawclaw", expected: null },
    { input: " @crawclaw/plugin ", expected: null },
    { input: " latest ", expected: "latest" },
    { input: "@other/plugin@beta", expected: "@other/plugin@beta" },
    { input: "crawclawer@beta", expected: "crawclawer@beta" },
  ] satisfies ReadonlyArray<{ input: string | undefined; expected: string | null }>)(
    "normalizes %j",
    ({ input, expected }) => {
      expect(normalizePackageTagInput(input, packageNames)).toBe(expected);
    },
  );
});
