import { isProcedureNodeType } from "../types/graph.ts";
import type { ExtractedEdge, ExtractedNode } from "./extractor.ts";

function textContainsAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

export function inferEdgesFromNodes(
  nodes: ExtractedNode[],
  messages: Array<{ role: string; content: string; turnIndex: number }>,
): ExtractedEdge[] {
  const combined = messages.map((m) => m.content).join("\n");
  const edges: ExtractedEdge[] = [];
  const tasks = nodes.filter((n) => n.type === "TASK");
  const skills = nodes.filter((n) => isProcedureNodeType(n.type));
  const events = nodes.filter((n) => n.type === "EVENT");

  for (const event of events) {
    for (const skill of skills) {
      if (
        textContainsAny(combined, [
          "根因",
          "解决",
          "修复",
          "恢复",
          "restart",
          "重启",
          "fix",
          "restore",
        ])
      ) {
        edges.push({
          from: event.name,
          to: skill.name,
          type: "SOLVED_BY",
          instruction: `Inferred from conversation: ${event.name} is addressed by ${skill.name}`,
        });
      }
    }
  }

  for (const task of tasks) {
    for (const skill of skills) {
      if (
        textContainsAny(combined, [
          "步骤",
          "执行",
          "调用",
          "重启",
          "修复",
          "restore",
          "fix",
          "restart",
        ])
      ) {
        edges.push({
          from: task.name,
          to: skill.name,
          type: "USED_SKILL",
          instruction: `Inferred from conversation: ${task.name} uses ${skill.name}`,
        });
      }
    }
  }

  // 去重
  const seen = new Set<string>();
  return edges.filter((e) => {
    const k = `${e.from}|${e.to}|${e.type}`;
    if (seen.has(k)) {
      return false;
    }
    seen.add(k);
    return true;
  });
}
