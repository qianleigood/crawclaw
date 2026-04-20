import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("app-root no longer renders legacy cp-page inline templates", () => {
  const source = readFileSync("src/ui/rewrite/app-root.ts", "utf8");
  expect(source.includes('<section class="cp-page cp-page--')).toBe(false);
  expect(source.includes("private renderOverviewPage(")).toBe(false);
  expect(source.includes("private renderChannelsPage(")).toBe(false);
});
