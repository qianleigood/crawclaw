import { describe, expect, it } from "vitest";
import { isGatewayArgv, parseProcCmdline, parseWindowsCmdline } from "./gateway-process-argv.js";

describe("parseProcCmdline", () => {
  it("splits null-delimited argv and trims empty entries", () => {
    expect(parseProcCmdline(" node \0 gateway \0\0 --port \0 18789 \0")).toEqual([
      "node",
      "gateway",
      "--port",
      "18789",
    ]);
  });

  it("keeps non-delimited single arguments and drops whitespace-only entries", () => {
    expect(parseProcCmdline(" gateway ")).toEqual(["gateway"]);
    expect(parseProcCmdline(" \0\t\0 ")).toEqual([]);
  });
});

describe("parseWindowsCmdline", () => {
  it("splits unquoted tokens by whitespace", () => {
    expect(parseWindowsCmdline("node.exe gateway run")).toEqual(["node.exe", "gateway", "run"]);
  });

  it("handles double-quoted paths with spaces", () => {
    expect(
      parseWindowsCmdline('"C:\\Program Files\\node.exe" "C:\\my app\\dist\\index.js" gateway run'),
    ).toEqual(["C:\\Program Files\\node.exe", "C:\\my app\\dist\\index.js", "gateway", "run"]);
  });

  it("returns empty array for empty input", () => {
    expect(parseWindowsCmdline("")).toEqual([]);
    expect(parseWindowsCmdline("   ")).toEqual([]);
  });

  it("collapses consecutive spaces outside quotes", () => {
    expect(parseWindowsCmdline("node.exe   gateway   run")).toEqual(["node.exe", "gateway", "run"]);
  });
});

describe("isGatewayArgv", () => {
  it("requires the internal gateway binary", () => {
    expect(isGatewayArgv(["node", "dist/runtime.js", "--port", "18789"])).toBe(false);
    expect(isGatewayArgv(["C:\\bin\\crawclaw.cmd", "gateway"])).toBe(false);
    expect(isGatewayArgv(["/app/dist/native/crawclaw", "gateway"])).toBe(false);
  });

  it("does not treat old TS entrypoints as Gateway runtimes", () => {
    expect(isGatewayArgv(["NODE", "C:\\CrawClaw\\DIST\\ENTRY.JS", "gateway"])).toBe(false);
    expect(isGatewayArgv(["bun", "/srv/crawclaw/scripts/run-node.mjs", "gateway"])).toBe(false);
    expect(isGatewayArgv(["node", "/srv/crawclaw/crawclaw.mjs", "gateway"])).toBe(false);
    expect(isGatewayArgv(["tsx", "/srv/crawclaw/src/old-entry.ts", "gateway"])).toBe(false);
    expect(isGatewayArgv(["tsx", "/srv/crawclaw/src/old-index.ts", "gateway"])).toBe(false);
  });

  it("matches the Rust gateway binary", () => {
    expect(isGatewayArgv(["/usr/local/bin/crawclaw-gateway", "--bind", "127.0.0.1"])).toBe(true);
    expect(isGatewayArgv(["C:\\bin\\crawclaw-gateway.EXE", "--port", "18789"])).toBe(true);
  });

  it("rejects unknown gateway argv even when the token is present", () => {
    expect(isGatewayArgv(["node", "/srv/crawclaw/custom.js", "gateway"])).toBe(false);
    expect(isGatewayArgv(["python", "gateway", "script.py"])).toBe(false);
  });
});
