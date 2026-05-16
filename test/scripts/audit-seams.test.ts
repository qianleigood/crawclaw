import { describe, expect, it } from "vitest";
import {
  HELP_TEXT,
  describeSeamKinds,
  determineSeamTestStatus,
} from "../../scripts/audit-seams.mjs";

describe("audit-seams subagent seam classification", () => {
  it("detects subagent spawn and cleanup handoff boundaries", () => {
    const source = `
      import { callGateway } from "../gateway/call.js";
      import { emitSessionLifecycleEvent } from "../sessions/session-lifecycle-events.js";
      import { registerSubagentRun } from "./subagent-registry.js";

      export async function spawnSubagentDirect() {
        const response = await callGateway({ method: "agent.run", params: { task: "do it" } });
        registerSubagentRun({ childSessionKey: "agent:main:subagent:child" });
        await callGateway({ method: "sessions.delete", params: { key: "agent:main:subagent:child" } });
        emitSessionLifecycleEvent({ sessionKey: "agent:main:subagent:child", type: "spawned" });
        return response;
      }
    `;

    expect(describeSeamKinds("src/agents/subagent-spawn.ts", source)).toEqual([
      "subagent-lifecycle-registry",
      "subagent-session-cleanup",
      "subagent-session-spawn",
    ]);
  });

  it("detects subagent lifecycle registry and announce delivery seams", () => {
    const source = `
      import { resolveContextEngine } from "../context-engine/registry.js";
      import { captureSubagentCompletionReply, runSubagentAnnounceFlow } from "./subagent-announce.js";
      import { emitSubagentEndedHookOnce } from "./subagent-registry-completion.js";
      import { persistSubagentRunsToDisk } from "./subagent-registry-state.js";

      export async function completeRun(entry) {
        await resolveContextEngine({});
        await captureSubagentCompletionReply(entry.childSessionKey);
        await emitSubagentEndedHookOnce({ runId: entry.runId });
        persistSubagentRunsToDisk(new Map());
        return runSubagentAnnounceFlow({ childSessionKey: entry.childSessionKey });
      }
    `;

    expect(describeSeamKinds("src/agents/subagent-registry.ts", source)).toEqual([
      "subagent-announce-delivery",
      "subagent-lifecycle-registry",
    ]);
  });

  it("detects parent-stream seams for ACP spawn relays", () => {
    const source = `
      import { onAgentEvent } from "../infra/agent-events.js";
      import { requestMainSessionWakeNow } from "../infra/main-session-wake.js";
      import { enqueueSystemEvent } from "../infra/system-events.js";

      export function startAcpSpawnParentStreamRelay() {
        onAgentEvent("agent-output", () => {});
        requestMainSessionWakeNow({ sessionKey: "agent:main" });
        enqueueSystemEvent("progress", { sessionKey: "agent:main", contextKey: "stream" });
        return { streamTo: "parent" };
      }
    `;

    expect(describeSeamKinds("src/agents/acp-spawn-parent-stream.ts", source)).toEqual([
      "subagent-parent-stream",
    ]);
  });
});

describe("audit-seams status/help", () => {
  it("keeps subagent seam statuses conservative when nearby tests exist", () => {
    expect(
      determineSeamTestStatus(
        ["subagent-session-spawn"],
        [{ file: "src/agents/subagent-spawn.workspace.test.ts", matchQuality: "direct-import" }],
      ),
    ).toEqual({
      status: "partial",
      reason:
        "Nearby tests exist (best match: direct-import), but this inventory does not prove cross-layer seam coverage end to end.",
    });
  });

  it("documents subagent seam coverage in help text", () => {
    expect(HELP_TEXT).toContain("subagent seams");
    expect(HELP_TEXT).toContain("announce delivery");
    expect(HELP_TEXT).toContain("parent streaming");
  });
});
