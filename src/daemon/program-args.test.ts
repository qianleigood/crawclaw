import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  realpath: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  default: { access: fsMocks.access, realpath: fsMocks.realpath },
  access: fsMocks.access,
  realpath: fsMocks.realpath,
}));

import { resolveGatewayProgramArguments } from "./program-args.js";

const originalArgv = [...process.argv];

afterEach(() => {
  process.argv = [...originalArgv];
  vi.resetAllMocks();
});

describe("resolveGatewayProgramArguments", () => {
  it("uses realpath-resolved native gateway when running via npx shim", async () => {
    const argv1 = path.resolve("/tmp/.npm/_npx/63c3/node_modules/.bin/crawclaw");
    const gatewayPath = path.resolve(
      "/tmp/.npm/_npx/63c3/node_modules/crawclaw/dist/native/crawclaw-gateway",
    );
    process.argv = ["node", argv1];
    fsMocks.realpath.mockResolvedValue(gatewayPath);
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === gatewayPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    expect(result.programArguments).toEqual([gatewayPath, "--port", "18789"]);
  });

  it("prefers symlinked path over realpath for stable service config", async () => {
    // Simulates pnpm global install where node_modules/crawclaw is a symlink
    // to .pnpm/crawclaw@X.Y.Z/node_modules/crawclaw
    const symlinkPath = path.resolve(
      "/Users/test/Library/pnpm/global/5/node_modules/crawclaw/dist/native/crawclaw-gateway",
    );
    const realpathResolved = path.resolve(
      "/Users/test/Library/pnpm/global/5/node_modules/.pnpm/crawclaw@2026.1.21-2/node_modules/crawclaw/dist/native/crawclaw-gateway",
    );
    process.argv = ["node", symlinkPath];
    fsMocks.realpath.mockResolvedValue(realpathResolved);
    fsMocks.access.mockResolvedValue(undefined); // Both paths exist

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    // Should use the symlinked path, not the realpath-resolved versioned path
    expect(result.programArguments[0]).toBe(symlinkPath);
    expect(result.programArguments[0]).not.toContain("@2026.1.21-2");
  });

  it("falls back to node_modules package native gateway when .bin path is not resolved", async () => {
    const argv1 = path.resolve("/tmp/.npm/_npx/63c3/node_modules/.bin/crawclaw");
    const gatewayPath = path.resolve(
      "/tmp/.npm/_npx/63c3/node_modules/crawclaw/dist/native/crawclaw-gateway",
    );
    process.argv = ["node", argv1];
    fsMocks.realpath.mockRejectedValue(new Error("no realpath"));
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === gatewayPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({ port: 18789 });

    expect(result.programArguments).toEqual([gatewayPath, "--port", "18789"]);
  });

  it("uses target release gateway for dev mode", async () => {
    const repoToolPath = path.resolve("/repo/src/gateway/boot.ts");
    const gatewayPath = path.resolve("/repo/target/release/crawclaw-gateway");
    process.argv = ["/usr/local/bin/node", repoToolPath];
    fsMocks.realpath.mockResolvedValue(repoToolPath);
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === gatewayPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({
      dev: true,
      port: 18789,
      runtime: "node",
    });

    expect(result.programArguments).toEqual([gatewayPath, "--port", "18789"]);
    expect(result.workingDirectory).toBe(path.resolve("/repo"));
  });

  it("uses an explicit native gateway entrypoint when installing a service", async () => {
    const runtimeEntryPath = path.resolve(
      "/Applications/CrawClaw Desktop.app/Contents/Resources/runtime/crawclaw/bin/crawclaw-gateway",
    );
    process.argv = [
      "/Applications/CrawClaw Desktop.app/Contents/MacOS/CrawClaw Desktop",
      runtimeEntryPath,
    ];
    fsMocks.access.mockImplementation(async (target: string) => {
      if (target === runtimeEntryPath) {
        return;
      }
      throw new Error("missing");
    });

    const result = await resolveGatewayProgramArguments({
      port: 18789,
      runtime: "node",
      runtimeEntryPath,
    });

    expect(result.programArguments).toEqual([runtimeEntryPath, "--port", "18789"]);
  });
});
