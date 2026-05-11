import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("TS Gateway server runtime guardrail", () => {
  it("keeps production source from importing the disabled TS Gateway runtime", () => {
    const offenders = findProductionGatewayRuntimeImports(path.join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  it("blocks production imports unless explicitly allowed", () => {
    const script = `
      delete process.env.VITEST;
      delete process.env.CRAWCLAW_ALLOW_TS_GATEWAY;
      await import("./src/gateway/server.ts").then(
        () => {
          console.error("unexpected TS Gateway import success");
          process.exit(1);
        },
        (error) => {
          const message = String(error?.message ?? error);
          if (!message.includes("TypeScript Gateway server runtime is disabled")) {
            console.error(message);
            process.exit(1);
          }
        },
      );
    `;

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CRAWCLAW_ALLOW_TS_GATEWAY: undefined,
          VITEST: undefined,
        },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

function findProductionGatewayRuntimeImports(root: string): string[] {
  const offenders: string[] = [];
  for (const file of listTypeScriptFiles(root)) {
    const relative = path.relative(repoRoot, file);
    if (isTestOrGatewayRuntimeFile(relative)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of importedModuleSpecifiers(source)) {
      if (
        resolveTypeScriptImport(file, specifier) === path.join(repoRoot, "src/gateway/server.ts")
      ) {
        offenders.push(relative);
      }
    }
  }
  return offenders.toSorted();
}

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

function isTestOrGatewayRuntimeFile(relative: string): boolean {
  if (
    relative.endsWith(".test.ts") ||
    relative.endsWith(".suite.ts") ||
    relative.endsWith(".d.ts")
  ) {
    return true;
  }
  return (
    relative === "src/gateway/server.ts" ||
    relative === "src/gateway/server.impl.ts" ||
    relative.startsWith("src/gateway/test-") ||
    relative.startsWith("src/gateway/server.e2e-ws-harness")
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
