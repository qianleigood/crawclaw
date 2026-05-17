import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const GATEWAY_CLIENT_CONSTRUCTOR_PATTERN = /new\s+GatewayClient\s*\(/;

const ALLOWED_GATEWAY_CLIENT_CALLSITES = new Set<string>();

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(fullPath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".ts")) {
      continue;
    }
    if (
      entry.name.endsWith(".test.ts") ||
      entry.name.endsWith(".e2e.ts") ||
      entry.name.endsWith(".e2e.test.ts") ||
      entry.name.endsWith(".live.test.ts")
    ) {
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

describe("GatewayClient production callsites", () => {
  it("remain constrained to allowlisted files", async () => {
    const root = process.cwd();
    const sourceFiles = await collectSourceFiles(path.join(root, "src"));
    const callsites: string[] = [];
    for (const fullPath of sourceFiles) {
      const relativePath = path.relative(root, fullPath).replaceAll(path.sep, "/");
      const content = await fs.readFile(fullPath, "utf8");
      if (GATEWAY_CLIENT_CONSTRUCTOR_PATTERN.test(content)) {
        callsites.push(relativePath);
      }
    }
    const expected = [...ALLOWED_GATEWAY_CLIENT_CALLSITES].toSorted();
    expect(callsites.toSorted()).toEqual(expected);
  });

  it("keeps callGateway off static GatewayClient and protocol imports", async () => {
    const source = await fs.readFile(path.join(process.cwd(), "src/gateway/call.ts"), "utf8");

    expect(source).not.toMatch(/from\s+["']\.\/client\.js["']/);
    expect(source).not.toMatch(/from\s+["']\.\/protocol\/index\.js["']/);
    expect(source).not.toContain('import("./client.js")');
  });

  it("does not keep the old TypeScript gateway server close helper", async () => {
    await expect(
      fs.stat(path.join(process.cwd(), "src/gateway/server-close.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not keep the old Gateway client connect-error compatibility helper", async () => {
    await expect(
      fs.stat(path.join(process.cwd(), "src/gateway/protocol/connect-error-details.ts")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not keep the old plugin Gateway request handler type bridge", async () => {
    await expect(
      fs.stat(path.join(process.cwd(), "src/gateway/request-types.ts")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      fs.stat(path.join(process.cwd(), "src/plugins/runtime/gateway-request-scope.ts")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
