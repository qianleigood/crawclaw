import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(thisDir, "../..");

function collectSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectSourceFiles(absolutePath);
    }
    return entry.isFile() && absolutePath.endsWith(".ts") ? [absolutePath] : [];
  });
}

describe("channel setup registry", () => {
  it("does not statically import the bundled TS channel loader", () => {
    const source = fs.readFileSync(path.join(thisDir, "setup-registry.ts"), "utf8");

    expect(source).not.toMatch(/from\s+["']\.\/bundled\.js["']/);
  });

  it("keeps production sources off the bundled TS channel loader", () => {
    const importPattern =
      /from\s+["'](?:\.\/bundled\.js|\.\.\/bundled\.js|\.\.\/channels\/plugins\/bundled\.js)["']/;
    const matches = collectSourceFiles(sourceRoot)
      .filter((file) => !file.endsWith(".test.ts"))
      .filter(
        (file) =>
          !file.includes(`${path.sep}channels${path.sep}plugins${path.sep}contracts${path.sep}`),
      )
      .filter((file) => importPattern.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(sourceRoot, file).replaceAll(path.sep, "/"));

    expect(matches).toEqual([]);
  });
});
