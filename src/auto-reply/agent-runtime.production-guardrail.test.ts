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
    const policy = readSource("src/auto-reply/reply/ts-agent-loop-compatibility.ts");

    expect(source).toContain("dispatchInboundWithRustAgent");
    expect(source).toContain("isTsAgentLoopCompatibilityAllowed");
    expect(policy).toContain('env.NODE_ENV === "test"');
    expect(policy).toContain('env.VITEST === "true"');
    expect(source).not.toContain("return Boolean(params.replyResolver);");
    expect(source).not.toContain("CRAWCLAW_ENABLE_TS_AGENT_LOOP");
  });

  it("keeps TS reply runtime facades test-only", () => {
    const guardedSources = [
      "src/auto-reply/reply/get-reply.ts",
      "src/auto-reply/reply/get-reply-run.ts",
      "src/auto-reply/reply/dispatch-from-config.ts",
    ];

    for (const file of guardedSources) {
      expect(readSource(file)).toContain("assertTsAgentLoopCompatibilityAllowed");
    }
  });

  it("keeps plugin-sdk inbound dispatch off the TS reply loop", () => {
    const source = readSource("src/plugin-sdk/inbound-reply-dispatch.ts");

    expect(source).toContain("dispatchInboundWithRustAgent");
    expect(source).not.toContain("../auto-reply/reply/dispatch-from-config");
    expect(source).not.toContain("dispatchReplyFromConfig({");
  });

  it("keeps main-session wake replies on the Rust agent runtime", () => {
    const source = readSource("src/infra/main-session-wake-runner.ts");

    expect(source).toContain("runMainSessionWakeReply");
    expect(source).not.toContain("getReplyFromConfig");
  });
});
