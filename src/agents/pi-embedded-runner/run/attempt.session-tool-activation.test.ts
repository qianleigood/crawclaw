import { describe, expect, it } from "vitest";
import { ensureAllowedToolsActiveInSession } from "./attempt.ts";

const __private = (
  ensureAllowedToolsActiveInSession as typeof ensureAllowedToolsActiveInSession & {
    __test_resolveEffectiveToolsAllow?: (params: {
      toolsAllow?: string[];
      inheritedToolNames?: string[];
      specialAgentSpawnSource?: string;
    }) => string[] | undefined;
  }
).__test_resolveEffectiveToolsAllow;

describe("ensureAllowedToolsActiveInSession", () => {
  it("re-activates missing allowlisted tools via session registry first", () => {
    const tools = [{ name: "memory_manifest_read" }, { name: "read" }];
    const session = {
      agent: {
        state: {
          tools: [] as Array<{ name: string }>,
        },
        setTools(nextTools: Array<{ name: string }>) {
          this.state.tools = nextTools;
        },
      },
      setActiveToolsByName(toolNames: string[]) {
        this.agent.state.tools = tools.filter((tool) => toolNames.includes(tool.name));
      },
    };

    const result = ensureAllowedToolsActiveInSession({
      session,
      toolsAllow: ["memory_manifest_read"],
      effectiveTools: tools,
    });

    expect(result.expectedToolNames).toEqual(["memory_manifest_read"]);
    expect(result.missingBefore).toEqual(["memory_manifest_read"]);
    expect(result.missingAfter).toEqual([]);
    expect(result.usedDirectRuntimeRegistration).toBe(true);
    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["memory_manifest_read"]);
  });

  it("uses direct runtime registration when session activation still misses allowlisted tools", () => {
    const tools = [{ name: "memory_manifest_read" }, { name: "read" }];
    const session = {
      agent: {
        state: {
          tools: [] as Array<{ name: string }>,
        },
        setTools(nextTools: Array<{ name: string }>) {
          this.state.tools = nextTools;
        },
      },
      setActiveToolsByName() {
        // Simulate a session registry that failed to surface the allowlisted tool.
      },
    };

    const result = ensureAllowedToolsActiveInSession({
      session,
      toolsAllow: ["memory_manifest_read"],
      effectiveTools: tools,
    });

    expect(result.missingBefore).toEqual(["memory_manifest_read"]);
    expect(result.missingAfter).toEqual([]);
    expect(result.usedDirectRuntimeRegistration).toBe(true);
    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual(["memory_manifest_read"]);
  });

  it("uses the agent state tools setter when no setTools helper exists", () => {
    const tools = [{ name: "session_status" }, { name: "sessions_list" }];
    const session = {
      agent: {
        state: {
          tools: [] as Array<{ name: string }>,
        },
      },
      setActiveToolsByName() {
        // Simulate the runtime registry not exposing CrawClaw-owned tools.
      },
    };

    const result = ensureAllowedToolsActiveInSession({
      session,
      effectiveTools: tools,
    });

    expect(result.expectedToolNames).toEqual(["session_status", "sessions_list"]);
    expect(result.missingBefore).toEqual(["session_status", "sessions_list"]);
    expect(result.missingAfter).toEqual([]);
    expect(result.usedDirectRuntimeRegistration).toBe(true);
    expect(session.agent.state.tools.map((tool) => tool.name)).toEqual([
      "session_status",
      "sessions_list",
    ]);
  });

  it("does not fall back to inherited parent tools for special-agent runs", () => {
    expect(__private).toBeTypeOf("function");
    expect(
      __private?.({
        inheritedToolNames: ["read", "write"],
        specialAgentSpawnSource: "memory-extraction",
      }),
    ).toBeUndefined();
  });
});
