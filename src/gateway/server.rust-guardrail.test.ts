import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const removedTsGatewayHandlersFile = ["legacy-ts-gateway", "handlers.ts"].join("-");
const removedTsGatewayRuntimeFiles = [
  "src/gateway/server.ts",
  "src/gateway/server.impl.ts",
  "src/gateway/server-runtime-state.ts",
  "src/gateway/server-http.ts",
  "src/gateway/server-broadcast.ts",
  "src/gateway/server-chat.ts",
  "src/gateway/server-maintenance.ts",
  "src/gateway/server-plugin-bootstrap.ts",
  "src/gateway/server-plugins.ts",
  "src/gateway/server-reload-handlers.ts",
  "src/gateway/server-close.ts",
  "src/gateway/server-cron.ts",
  "src/gateway/server-discovery-runtime.ts",
  "src/gateway/server-discovery.ts",
  "src/gateway/server-lanes.ts",
  "src/gateway/server-model-catalog.ts",
  "src/gateway/server-methods/config.ts",
  "src/gateway/server-methods/send.ts",
  "src/gateway/server-methods/skills.ts",
  "src/gateway/server-methods/talk.ts",
  "src/gateway/server-methods/web.ts",
  "src/gateway/server-methods/wizard.ts",
  "src/gateway/server-restart-sentinel.ts",
  "src/gateway/server-runtime-config.ts",
  "src/gateway/server-session-key.ts",
  "src/gateway/server-startup-log.ts",
  "src/gateway/server-startup-session-migration.ts",
  "src/gateway/server-startup.ts",
  "src/gateway/server-tailscale.ts",
  "src/gateway/server-utils.ts",
  "src/gateway/server-wizard-sessions.ts",
  "src/gateway/server/hooks.ts",
  "src/gateway/server/http-auth.ts",
  "src/gateway/server/http-listen.ts",
  "src/gateway/server/plugins-http.ts",
  "src/gateway/server/preauth-connection-budget.ts",
  "src/gateway/server/readiness.ts",
  "src/gateway/server/tls.ts",
  "src/gateway/server/ws-types.ts",
];

describe("TS Gateway server runtime guardrail", () => {
  it("keeps the legacy TS Gateway runtime entrypoints removed", () => {
    const existing = removedTsGatewayRuntimeFiles.filter((relative) =>
      fs.existsSync(path.join(repoRoot, relative)),
    );
    expect(existing).toEqual([]);
  });

  it("keeps production source from importing the disabled TS Gateway runtime", () => {
    const offenders = findProductionGatewayRuntimeImports(path.join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  it("keeps old TS Gateway handlers out of production imports", () => {
    const offenders = findProductionGatewayHandlerImports(path.join(repoRoot, "src"));

    expect(offenders).toEqual([]);
  });

  it("keeps the legacy TS Gateway opt-in disabled by removing the entrypoint", () => {
    const script = `
      process.env.CRAWCLAW_ALLOW_TS_GATEWAY = "1";
      await import("./src/gateway/server.ts").then(
        () => {
          console.error("unexpected TS Gateway import success");
          process.exit(1);
        },
        (error) => {
          const code = String(error?.code ?? "");
          const message = String(error?.message ?? error);
          if (code !== "ERR_MODULE_NOT_FOUND" && !message.includes("Cannot find module")) {
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
          CRAWCLAW_ALLOW_TS_GATEWAY: "1",
          VITEST: undefined,
          VITEST_POOL_ID: undefined,
          NODE_ENV: undefined,
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
    relative.startsWith("src/gateway/test-") ||
    relative.startsWith("src/gateway/server.e2e-ws-harness")
  );
}

function findProductionGatewayHandlerImports(root: string): string[] {
  const offenders: string[] = [];
  for (const file of listTypeScriptFiles(root)) {
    const relative = path.relative(repoRoot, file);
    if (isTestOrLegacyGatewayHandlerFile(relative)) {
      continue;
    }
    const source = fs.readFileSync(file, "utf8");
    for (const specifier of valueImportedModuleSpecifiers(source)) {
      if (resolveTypeScriptImport(file, specifier)?.includes(removedTsGatewayHandlersFile)) {
        offenders.push(relative);
      }
    }
  }
  return offenders.toSorted();
}

function isTestOrLegacyGatewayHandlerFile(relative: string): boolean {
  if (
    relative.endsWith(".test.ts") ||
    relative.endsWith(".suite.ts") ||
    relative.endsWith(".d.ts")
  ) {
    return true;
  }
  return false;
}

function importedModuleSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:from\s+|import\(\s*)["']([^"']+)["']/g),
    (match) => match[1] ?? "",
  ).filter(Boolean);
}

function valueImportedModuleSpecifiers(source: string): string[] {
  const staticImports = Array.from(
    source.matchAll(/import\s+(?!type\b)(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g),
    (match) => match[1] ?? "",
  );
  const dynamicImports = Array.from(
    source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
    (match) => match[1] ?? "",
  );
  return [...staticImports, ...dynamicImports].filter(Boolean);
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
