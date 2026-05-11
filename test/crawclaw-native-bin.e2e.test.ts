import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  bin?: Record<string, string>;
  exports?: Record<string, unknown>;
  files?: string[];
};

function readPackageJson(): PackageJson {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
}

describe("crawclaw native CLI package entry", () => {
  it("publishes the Rust binary directly without a JS launcher contract", () => {
    const pkg = readPackageJson();

    expect(pkg.bin).toEqual({ crawclaw: "dist/native/crawclaw" });
    expect(pkg.exports).not.toHaveProperty("./cli-entry");
    expect(pkg.files ?? []).not.toContain("crawclaw.mjs");
  });

  it("does not keep the root JS CLI launcher", () => {
    expect(fs.existsSync(path.join(process.cwd(), "crawclaw.mjs"))).toBe(false);
  });
});
