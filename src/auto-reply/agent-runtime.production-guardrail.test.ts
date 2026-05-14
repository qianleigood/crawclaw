import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function readSource(repoRelativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, repoRelativePath), "utf8");
}

describe("agent/channel Rust runtime production guardrails", () => {
  it("keeps the default inbound dispatch path on Rust agent.runTurn", () => {
    const source = readSource("src/auto-reply/dispatch.ts");

    expect(source).toContain("dispatchInboundWithRustAgent");
    expect(source).toContain('env.NODE_ENV === "test"');
    expect(source).toContain('env.VITEST === "true"');
    expect(source).not.toContain("return Boolean(params.replyResolver);");
    expect(source).not.toContain("CRAWCLAW_ENABLE_TS_AGENT_LOOP");
  });

  it("keeps plugin-sdk inbound dispatch off the TS reply loop", () => {
    const source = readSource("src/plugin-sdk/inbound-reply-dispatch.ts");

    expect(source).toContain("dispatchInboundWithRustAgent");
    expect(source).not.toContain("../auto-reply/reply/dispatch-from-config");
    expect(source).not.toContain("dispatchReplyFromConfig({");
  });

  it("keeps the bundled channel registry free of static Jiti loading", () => {
    const source = readSource("src/channels/plugins/bundled.ts");

    expect(source).not.toContain("createJiti");
    expect(source).toContain("loadBundledTsChannelModule");
  });

  it("keeps bundled channel compatibility Jiti loading out of the static import graph", () => {
    const source = readSource("src/channels/plugins/bundled-compat-loader.ts");

    expect(source).not.toMatch(/from\s+["']jiti["']/);
    expect(source).toContain('require("jiti")');
  });

  it("keeps main-session wake replies on the Rust agent runtime", () => {
    const source = readSource("src/infra/main-session-wake-runner.ts");

    expect(source).toContain("runMainSessionWakeReply");
    expect(source).not.toContain("getReplyFromConfig");
  });
});
