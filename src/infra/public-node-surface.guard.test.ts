import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const removedPublicNodeSourceFiles = ["src/index.ts", "src/entry.ts", "src/library.ts"] as const;

describe("public Node source surface guardrail", () => {
  it("keeps removed public Node source entries out of the repo", () => {
    const existing = removedPublicNodeSourceFiles.filter((relative) =>
      fs.existsSync(path.join(repoRoot, relative)),
    );

    expect(existing).toEqual([]);
  });

  it("keeps production source from importing removed public Node entries", () => {
    const removedTargets = new Set(
      removedPublicNodeSourceFiles.map((relative) => path.join(repoRoot, relative)),
    );
    const offenders: string[] = [];

    for (const file of listTypeScriptFiles(path.join(repoRoot, "src"))) {
      const relative = path.relative(repoRoot, file);
      if (isNonProductionSource(relative)) {
        continue;
      }

      const source = fs.readFileSync(file, "utf8");
      for (const specifier of importedModuleSpecifiers(source)) {
        const resolved = resolveTypeScriptImport(file, specifier);
        if (resolved && removedTargets.has(resolved)) {
          offenders.push(relative);
        }
      }
    }

    expect(offenders.toSorted()).toEqual([]);
  });
});

function listTypeScriptFiles(root: string): string[] {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(child));
    } else if (entry.isFile() && child.endsWith(".ts")) {
      files.push(child);
    }
  }
  return files;
}

function isNonProductionSource(relative: string): boolean {
  return (
    relative.endsWith(".test.ts") || relative.endsWith(".suite.ts") || relative.endsWith(".d.ts")
  );
}

function importedModuleSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:from\s+|import\(\s*)["']([^"']+)["']/g),
    (match) => match[1] ?? "",
  ).filter(Boolean);
}

function resolveTypeScriptImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) {
    return null;
  }
  const resolved = path.resolve(path.dirname(fromFile), specifier);
  if (resolved.endsWith(".js")) {
    return `${resolved.slice(0, -3)}.ts`;
  }
  return `${resolved}.ts`;
}
