import type { ExtractedNode } from "./extractor.ts";
import type { NodeType } from "../types/graph.ts";

const TYPE_PRIORITY: Record<NodeType, number> = {
  PROCEDURE: 4,
  SKILL: 3,
  EVENT: 2,
  TASK: 1,
};

export function dedupNodesByName(nodes: ExtractedNode[]): ExtractedNode[] {
  const byName = new Map<string, ExtractedNode>();
  for (const node of nodes) {
    const prev = byName.get(node.name);
    if (!prev) {
      byName.set(node.name, node);
      continue;
    }
    const pick = TYPE_PRIORITY[node.type] > TYPE_PRIORITY[prev.type] ? node : prev;
    const merged: ExtractedNode = {
      ...pick,
      description: (pick.description?.length ?? 0) >= (prev.description?.length ?? 0) ? pick.description : prev.description,
      content: (pick.content?.length ?? 0) >= (prev.content?.length ?? 0) ? pick.content : prev.content,
    };
    byName.set(node.name, merged);
  }
  return [...byName.values()];
}
