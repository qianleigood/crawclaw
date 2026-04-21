import { isProcedureNodeType } from "../types/graph.ts";

export type MemoryKind = "preference" | "decision" | "procedure" | "runtime_pattern" | "reference";

export interface MemoryProjectionInput {
  source?: string;
  title?: string;
  summary?: string;
  content?: string;
  layer?: string;
  metadata?: Record<string, unknown>;
  memoryKind?: MemoryKind;
}

const PREFERENCE_RE = /(prefer|preference|default|defaults|always|never|习惯|默认|偏好)/i;
const DECISION_RE = /(decision|trade ?off|why|为什么|架构|设计|结论|原则|约定)/i;
const PROCEDURE_RE =
  /(sop|runbook|playbook|procedure|workflow|步骤|流程|排查|操作|安装|配置|修复|回滚)/i;
const RUNTIME_RE =
  /(runtime|signal|incident|recent|latest|current|当前|最近|刚刚|history|execution|error|failure|失败|报错|状态)/i;

function readText(input: MemoryProjectionInput): string {
  return [input.title, input.summary, input.content]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function readTags(metadata: Record<string, unknown> | undefined): string[] {
  const tags = metadata?.tags;
  if (!Array.isArray(tags)) {
    return [];
  }
  return tags.filter((tag): tag is string => typeof tag === "string");
}

function hasMemoryKind(value: unknown): value is MemoryKind {
  return (
    value === "preference" ||
    value === "decision" ||
    value === "procedure" ||
    value === "runtime_pattern" ||
    value === "reference"
  );
}

function inferFromMetadata(input: MemoryProjectionInput): MemoryKind | undefined {
  const memoryKind = input.metadata?.memoryKind;
  if (hasMemoryKind(memoryKind)) {
    return memoryKind;
  }
  const kind = typeof input.metadata?.kind === "string" ? input.metadata.kind.toLowerCase() : "";
  const nodeType =
    typeof input.metadata?.nodeType === "string" ? input.metadata.nodeType.toUpperCase() : "";
  if (kind === "seed" || kind === "expanded-node") {
    if (nodeType === "TASK" || isProcedureNodeType(nodeType)) {
      return "procedure";
    }
    if (nodeType === "EVENT") {
      return "runtime_pattern";
    }
  }
  if (kind === "execution" || kind === "execution-hit") {
    return "runtime_pattern";
  }
  return undefined;
}

function inferFromLayer(layer: string | undefined): MemoryKind | undefined {
  if (layer === "preferences") {
    return "preference";
  }
  if (layer === "key_decisions") {
    return "decision";
  }
  if (layer === "sop") {
    return "procedure";
  }
  if (layer === "runtime_signals") {
    return "runtime_pattern";
  }
  return undefined;
}

function inferFromText(input: MemoryProjectionInput): MemoryKind | undefined {
  const text = readText(input);
  const tags = readTags(input.metadata);
  const taggedText = tags.join(" ");
  const haystack = [text, taggedText].filter(Boolean).join(" ");
  if (!haystack) {
    return undefined;
  }
  if (PREFERENCE_RE.test(haystack)) {
    return "preference";
  }
  if (DECISION_RE.test(haystack)) {
    return "decision";
  }
  if (PROCEDURE_RE.test(haystack)) {
    return "procedure";
  }
  if (RUNTIME_RE.test(haystack)) {
    return "runtime_pattern";
  }
  return undefined;
}

export function projectMemoryKind(input: MemoryProjectionInput): MemoryKind {
  if (input.memoryKind) {
    return input.memoryKind;
  }

  const explicit = inferFromMetadata(input);
  if (explicit) {
    return explicit;
  }

  const layered = inferFromLayer(input.layer);
  if (layered) {
    return layered;
  }

  if (input.source === "execution") {
    return "runtime_pattern";
  }
  if (input.source === "native_memory") {
    return inferFromText(input) ?? "reference";
  }
  if (input.source === "graph") {
    const textKind = inferFromText(input);
    if (textKind) {
      return textKind;
    }
    const nodeType =
      typeof input.metadata?.nodeType === "string" ? input.metadata.nodeType.toUpperCase() : "";
    if (nodeType === "TASK" || isProcedureNodeType(nodeType)) {
      return "procedure";
    }
    if (nodeType === "EVENT") {
      return "runtime_pattern";
    }
    return "reference";
  }
  if (input.source === "notebooklm" || input.source === "local_knowledge_index") {
    return inferFromText(input) ?? "reference";
  }

  return inferFromText(input) ?? "reference";
}

export function attachMemoryKind<T extends MemoryProjectionInput>(
  item: T,
): T & { memoryKind: MemoryKind } {
  return {
    ...item,
    memoryKind: projectMemoryKind(item),
  };
}

export function attachMemoryKinds<T extends MemoryProjectionInput>(
  items: readonly T[],
): Array<T & { memoryKind: MemoryKind }> {
  return items.map((item) => attachMemoryKind(item));
}
