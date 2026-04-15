import { isProcedureNodeType, type EdgeType, type NodeType } from "../types/graph.ts";
import type { ExtractedEdge } from "./extractor.ts";

const VALID_EDGE_TYPES = new Set<EdgeType>(["USED_SKILL", "SOLVED_BY", "REQUIRES", "PATCHES", "CONFLICTS_WITH"]);

const EDGE_FROM_CONSTRAINT: Record<EdgeType, Set<NodeType>> = {
  USED_SKILL: new Set(["TASK"]),
  SOLVED_BY: new Set(["EVENT", "PROCEDURE", "SKILL"]),
  REQUIRES: new Set(["PROCEDURE", "SKILL"]),
  PATCHES: new Set(["PROCEDURE", "SKILL"]),
  CONFLICTS_WITH: new Set(["PROCEDURE", "SKILL"]),
};

const EDGE_TO_CONSTRAINT: Record<EdgeType, Set<NodeType>> = {
  USED_SKILL: new Set(["PROCEDURE", "SKILL"]),
  SOLVED_BY: new Set(["PROCEDURE", "SKILL"]),
  REQUIRES: new Set(["PROCEDURE", "SKILL"]),
  PATCHES: new Set(["PROCEDURE", "SKILL"]),
  CONFLICTS_WITH: new Set(["PROCEDURE", "SKILL"]),
};

export function correctEdgeType(edge: ExtractedEdge, nameToType: Map<string, NodeType>): ExtractedEdge | null {
  const fromType = nameToType.get(edge.from);
  const toType = nameToType.get(edge.to);
  if (!fromType || !toType) {return null;}

  let type = edge.type;
  let from = edge.from;
  let to = edge.to;

  if (fromType === "TASK" && isProcedureNodeType(toType) && type !== "USED_SKILL") {type = "USED_SKILL";}
  if (fromType === "EVENT" && isProcedureNodeType(toType) && type !== "SOLVED_BY") {type = "SOLVED_BY";}

  // 常见模型误判修正：把 EVENT->TASK / TASK->EVENT 尽量折算到 EVENT->SKILL 或 TASK->SKILL 不现实时直接丢弃
  if (fromType === "EVENT" && toType === "TASK" && type === "SOLVED_BY") {return null;}
  if (fromType === "TASK" && toType === "EVENT" && type === "PATCHES") {return null;}
  if (fromType === "TASK" && toType === "TASK" && type === "REQUIRES") {return null;}
  if (fromType === "EVENT" && toType === "TASK" && type === "CONFLICTS_WITH") {return null;}
  if (fromType === "TASK" && toType === "TASK" && type === "SOLVED_BY") {return null;}
  if (isProcedureNodeType(fromType) && toType === "EVENT" && (type === "PATCHES" || type === "SOLVED_BY")) {return null;}

  if (!VALID_EDGE_TYPES.has(type)) {return null;}
  if (!EDGE_FROM_CONSTRAINT[type].has(fromType)) {return null;}
  if (!EDGE_TO_CONSTRAINT[type].has(toType)) {return null;}

  return { ...edge, from, to, type };
}
