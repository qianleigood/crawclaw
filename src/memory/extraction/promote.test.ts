import { describe, expect, it } from "vitest";
import { promoteTaskLikeSkills } from "./promote.ts";

describe("promoteTaskLikeSkills", () => {
  it("preserves procedure semantics when promoting reusable tasks into PROCEDURE nodes", () => {
    const promoted = promoteTaskLikeSkills([{
      type: "TASK",
      memoryKind: "procedure",
      name: "restart-memory-backend-services",
      description: "重启后端服务以恢复记忆链路",
      content: "步骤：检查 Neo4j/Qdrant 可达性，必要时重启服务并重新验证。",
    }]);

    expect(promoted).toHaveLength(1);
    expect(promoted[0].type).toBe("PROCEDURE");
    expect(promoted[0].memoryKind).toBe("procedure");
  });
});
