import { callStructuredOutput } from "../llm/structured-output.ts";
import type { MemoryKind } from "../recall/memory-kind.ts";
import { isProcedureNodeType, type EdgeType, type NodeType } from "../types/graph.ts";
import type { MessageBlock, MessageMediaRef } from "../types/media.ts";
import { dedupNodesByName } from "./dedup.ts";
import { inferEdgesFromNodes } from "./infer-edges.ts";
import type { CompleteFn } from "./llm.ts";
import { promoteTaskLikeSkills } from "./promote.ts";
import { correctEdgeType } from "./rules.ts";

export interface ExtractedNode {
  type: NodeType;
  memoryKind?: MemoryKind;
  name: string;
  description: string;
  content: string;
  image?: string | null;
  imageAlt?: string | null;
  mediaRefs?: string[];
  evidenceMode?: "text" | "image" | "multimodal";
  visualSummary?: string;
}

export interface ExtractedEdge {
  from: string;
  to: string;
  type: EdgeType;
  instruction: string;
  condition?: string;
}

export interface ExtractionResult {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
}

interface RawExtractionResult {
  nodes?: unknown[];
  edges?: unknown[];
}

function projectExtractedNodeMemoryKind(type: NodeType): MemoryKind {
  if (type === "TASK" || isProcedureNodeType(type)) {
    return "procedure";
  }
  return "runtime_pattern";
}

const EXTRACT_SYS = `你是 CrawClaw memory 的经验抽取器，要从 AI Agent 对话中提取“可复用、可迁移、带结论”的结构化知识。

输出要求：
1. 严格只输出 JSON：{"nodes":[...],"edges":[...]}。
2. 节点 type 只允许 TASK / PROCEDURE / EVENT。
3. 边 type 只允许 USED_SKILL / SOLVED_BY / REQUIRES / PATCHES / CONFLICTS_WITH。
4. 节点 name 使用全小写连字符；优先复用 Existing Nodes 中已有名字，不要无谓改名。
5. 只提取“对以后还有复用价值”的内容：问题、原因、修复动作、验证结论、依赖关系、冲突边界。
6. 闲聊、情绪、寒暄、一次性安排不要提取。
7. 如果证据不足，不要硬造；没有知识产出时返回 {"nodes":[],"edges":[]}。`;

const EXTRACT_FORMAT_HINT = `JSON schema:
{
  "nodes": [{
    "type": "TASK|PROCEDURE|EVENT",
    "name": "kebab-case-name",
    "description": "一句话描述，可复用结论优先",
    "content": "更完整的经验摘要，最好包含问题/原因/修复/验证",
    "image": "可选，图像 URL 或 data URI；仅在该节点明显依赖视觉证据时填写",
    "imageAlt": "可选，图像内容简述",
    "mediaRefs": ["可选，消息内 mediaId 列表"],
    "evidenceMode": "可选，text|image|multimodal",
    "visualSummary": "可选，视觉证据一两句话摘要"
  }],
  "edges": [{
    "from": "node-name",
    "to": "node-name",
    "type": "USED_SKILL|SOLVED_BY|REQUIRES|PATCHES|CONFLICTS_WITH",
    "instruction": "为什么存在这条关系",
    "condition": "可选，关系成立的边界或条件"
  }]
}`;

function summarizeMessageMedia(message: {
  contentBlocks?: MessageBlock[];
  primaryMediaId?: string | null;
  mediaRefs?: MessageMediaRef[];
}): string {
  const blocks = message.contentBlocks ?? [];
  const imageBlocks = blocks.filter(
    (block): block is Extract<MessageBlock, { type: "image" }> => block.type === "image",
  );
  const fileBlocks = blocks.filter(
    (block): block is Extract<MessageBlock, { type: "file" }> => block.type === "file",
  );
  if (!imageBlocks.length && !fileBlocks.length) {
    return "";
  }
  const imageSummary = imageBlocks.map((block) => {
    const ref = block.mediaId ? `mediaId=${block.mediaId}` : "media";
    const alt = block.alt || block.caption || block.url;
    return `image(${ref}): ${alt}`;
  });
  const fileSummary = fileBlocks.map((block) => {
    const ref = block.mediaId ? `mediaId=${block.mediaId}` : "file";
    return `file(${ref}): ${block.title || block.name || block.path}`;
  });
  return [...imageSummary, ...fileSummary].join(" | ");
}

function normalizeName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

function buildExistingNameIndex(existingNames: string[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const raw of existingNames) {
    const normalized = normalizeName(raw);
    if (!normalized || index.has(normalized)) {
      continue;
    }
    index.set(normalized, raw);
  }
  return index;
}

function canonicalizeName(name: string, existingNameIndex: Map<string, string>): string {
  const normalized = normalizeName(name);
  if (!normalized) {
    return "";
  }
  const exact = existingNameIndex.get(normalized);
  if (exact) {
    return exact;
  }

  for (const [key, value] of existingNameIndex.entries()) {
    if (key === normalized) {
      return value;
    }
    if (key.endsWith(normalized) || normalized.endsWith(key)) {
      return value;
    }
  }

  return normalized;
}

function isNodeType(value: unknown): value is NodeType {
  return value === "TASK" || value === "PROCEDURE" || value === "SKILL" || value === "EVENT";
}

function isEdgeType(value: unknown): value is EdgeType {
  return (
    value === "USED_SKILL" ||
    value === "SOLVED_BY" ||
    value === "REQUIRES" ||
    value === "PATCHES" ||
    value === "CONFLICTS_WITH"
  );
}

function unknownToText(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function normalizeNode(
  value: unknown,
  existingNameIndex: Map<string, string>,
): ExtractedNode | null {
  const n = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  if (!isNodeType(n.type) || !n.name) {
    return null;
  }
  const name = canonicalizeName(unknownToText(n.name, ""), existingNameIndex);
  if (!name) {
    return null;
  }
  const description = unknownToText(n.description, `${name} extracted from conversation`).trim();
  const content = unknownToText(n.content, `[${name}]\n说明: ${description}`).trim();
  const mediaRefs = Array.isArray(n.mediaRefs)
    ? n.mediaRefs.filter(
        (item: unknown): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  const evidenceMode =
    n.evidenceMode === "image" || n.evidenceMode === "multimodal" || n.evidenceMode === "text"
      ? n.evidenceMode
      : undefined;
  return {
    type: n.type,
    memoryKind:
      n.memoryKind === "preference" ||
      n.memoryKind === "decision" ||
      n.memoryKind === "procedure" ||
      n.memoryKind === "runtime_pattern" ||
      n.memoryKind === "reference"
        ? n.memoryKind
        : projectExtractedNodeMemoryKind(n.type),
    name,
    description,
    content,
    image: typeof n.image === "string" && n.image.trim() ? n.image : null,
    imageAlt: typeof n.imageAlt === "string" && n.imageAlt.trim() ? n.imageAlt : null,
    mediaRefs,
    evidenceMode,
    visualSummary:
      typeof n.visualSummary === "string" && n.visualSummary.trim()
        ? n.visualSummary.trim()
        : undefined,
  };
}

function normalizeEdge(
  value: unknown,
  existingNameIndex: Map<string, string>,
): ExtractedEdge | null {
  const e = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const from = canonicalizeName(unknownToText(e.from ?? e.source, ""), existingNameIndex);
  const to = canonicalizeName(unknownToText(e.to ?? e.target, ""), existingNameIndex);
  const type = e.type;
  const instruction = unknownToText(
    e.instruction,
    `${unknownToText(e.type, "RELATES_TO")} inferred from conversation`,
  ).trim();
  if (!from || !to || !isEdgeType(type) || !instruction) {
    return null;
  }
  return {
    from,
    to,
    type,
    instruction,
    condition: typeof e.condition === "string" ? e.condition : undefined,
  };
}

function validateRawExtractionResult(value: unknown): RawExtractionResult {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    nodes: Array.isArray(record.nodes) ? record.nodes : [],
    edges: Array.isArray(record.edges) ? record.edges : [],
  };
}

function buildRuleFallback(
  messages: Array<{
    role: string;
    content: string;
    turnIndex: number;
    contentBlocks?: MessageBlock[];
    primaryMediaId?: string | null;
    mediaRefs?: MessageMediaRef[];
  }>,
  existingNameIndex: Map<string, string>,
): ExtractionResult {
  const text = messages.map((item) => item.content).join("\n");
  const lower = text.toLowerCase();
  const firstMediaMessage = messages.find(
    (message) =>
      message.primaryMediaId ||
      message.mediaRefs?.length ||
      message.contentBlocks?.some((block) => block.type === "image"),
  );
  const mediaRefs =
    firstMediaMessage?.mediaRefs?.map((ref) => ref.mediaId) ??
    (firstMediaMessage?.primaryMediaId ? [firstMediaMessage.primaryMediaId] : []);
  const firstImageBlock = firstMediaMessage?.contentBlocks?.find(
    (block): block is Extract<MessageBlock, { type: "image" }> => block.type === "image",
  );
  const nodes: ExtractedNode[] = [];
  const edges: ExtractedEdge[] = [];

  if (/(too many nested clauses|maxclausecount|toomanynestedclauses)/i.test(text)) {
    const eventName = canonicalizeName("neo4j-fulltext-too-many-clauses", existingNameIndex);
    const skillName = canonicalizeName("query-shaping-and-fts-fallback", existingNameIndex);
    nodes.push(
      {
        type: "EVENT",
        memoryKind: "runtime_pattern",
        name: eventName,
        description: "Neo4j fulltext recall 因 clause 膨胀失败",
        content:
          "问题: Neo4j fulltext query 触发 TooManyNestedClauses。原因: 长 query / 噪声 token 导致 Lucene clauses 爆炸。",
        image: firstImageBlock?.url ?? null,
        imageAlt: firstImageBlock?.alt ?? null,
        mediaRefs,
        evidenceMode: firstImageBlock ? "multimodal" : "text",
        visualSummary: firstImageBlock?.alt ?? undefined,
      },
      {
        type: "PROCEDURE",
        memoryKind: "procedure",
        name: skillName,
        description: "通过 query shaping 与 FTS fallback 限制 clauses 膨胀",
        content:
          "修复: 收紧 query token、压缩 fulltext query，并在超限时降级到更稳的 recall 路径。",
        image: firstImageBlock?.url ?? null,
        imageAlt: firstImageBlock?.alt ?? null,
        mediaRefs,
        evidenceMode: firstImageBlock ? "multimodal" : "text",
        visualSummary: firstImageBlock?.alt ?? undefined,
      },
    );
    edges.push({
      from: eventName,
      to: skillName,
      type: "SOLVED_BY",
      instruction: "TooManyNestedClauses 通常由 query shaping + fallback 解决",
    });
  }

  if (
    (/qdrant/i.test(text) || /neo4j/i.test(text)) &&
    /(restart|重启|恢复|restore|reachable|连通)/i.test(text)
  ) {
    const taskName = canonicalizeName("restart-memory-backend-services", existingNameIndex);
    nodes.push({
      type: "TASK",
      memoryKind: "procedure",
      name: taskName,
      description: "重启相关后端服务以恢复知识链路",
      content:
        "动作: 检查相关后端依赖是否可达，必要时重启容器或服务，并再次验证知识库与启动健康状态。",
      image: firstImageBlock?.url ?? null,
      imageAlt: firstImageBlock?.alt ?? null,
      mediaRefs,
      evidenceMode: firstImageBlock ? "multimodal" : "text",
      visualSummary: firstImageBlock?.alt ?? undefined,
    });
  }

  if (
    !nodes.length &&
    /(修复|恢复|解决|fix|restore|resolved|验证|verify|结论|root cause|原因)/i.test(lower)
  ) {
    const eventName = canonicalizeName("conversation-derived-fix-summary", existingNameIndex);
    nodes.push({
      type: "EVENT",
      memoryKind: "runtime_pattern",
      name: eventName,
      description: "对话中出现了可复用的问题-修复-验证总结",
      content: text.slice(0, 500),
      image: firstImageBlock?.url ?? null,
      imageAlt: firstImageBlock?.alt ?? null,
      mediaRefs,
      evidenceMode: firstImageBlock ? "multimodal" : "text",
      visualSummary: firstImageBlock?.alt ?? undefined,
    });
  }

  return {
    nodes: dedupNodesByName(promoteTaskLikeSkills(nodes)),
    edges,
  };
}

export class Extractor {
  constructor(private readonly llm: CompleteFn) {}

  async extract(params: {
    messages: Array<{
      role: string;
      content: string;
      turnIndex: number;
      contentBlocks?: MessageBlock[];
      primaryMediaId?: string | null;
      mediaRefs?: MessageMediaRef[];
    }>;
    existingNames: string[];
  }): Promise<ExtractionResult> {
    const conversation = params.messages
      .map((m) => {
        const media = summarizeMessageMedia(m);
        return `[${m.role.toUpperCase()} t=${m.turnIndex}]\n${m.content.slice(0, 1000)}${media ? `\n<MEDIA>${media}</MEDIA>` : ""}`;
      })
      .join("\n\n---\n\n");

    if (!conversation.trim()) {
      return { nodes: [], edges: [] };
    }

    const existingNameIndex = buildExistingNameIndex(params.existingNames);
    const user = `<Existing Nodes>\n${params.existingNames.join(", ") || "（无）"}\n\n<Conversation>\n${conversation}`;
    const structured = await callStructuredOutput(this.llm, {
      system: EXTRACT_SYS,
      user,
      formatHint: EXTRACT_FORMAT_HINT,
      retries: 1,
      validator: validateRawExtractionResult,
      fallback: () => validateRawExtractionResult({ nodes: [], edges: [] }),
    });

    if (process.env.GM_NEO4J_DEBUG) {
      console.log(
        "[gm-neo4j] raw extract response:\n" + JSON.stringify(structured.raw).slice(0, 4000),
      );
      console.log("[gm-neo4j] extract trace=", JSON.stringify(structured.trace, null, 2));
    }

    const parsed = structured.value;
    const normalizedNodes = (parsed.nodes ?? [])
      .map((n) => normalizeNode(n, existingNameIndex))
      .filter((n: ExtractedNode | null): n is ExtractedNode => Boolean(n));

    const ruleFallback = !normalizedNodes.length
      ? buildRuleFallback(params.messages, existingNameIndex)
      : { nodes: [], edges: [] };

    const nodes = dedupNodesByName(
      promoteTaskLikeSkills([...normalizedNodes, ...ruleFallback.nodes]),
    );
    const validNames = new Set(nodes.map((n: ExtractedNode) => n.name));
    const nameToType: Map<string, NodeType> = new Map(
      nodes.map((n: ExtractedNode) => [n.name, n.type] as [string, NodeType]),
    );

    const modelEdges = (parsed.edges ?? [])
      .map((e) => normalizeEdge(e, existingNameIndex))
      .filter((e: ExtractedEdge | null): e is ExtractedEdge => Boolean(e));

    const inferredEdges = inferEdgesFromNodes(nodes, params.messages);

    const edges = [...modelEdges, ...ruleFallback.edges, ...inferredEdges]
      .filter((e: ExtractedEdge) => validNames.has(e.from) && validNames.has(e.to))
      .map((e: ExtractedEdge) => correctEdgeType(e, nameToType))
      .filter((e: ExtractedEdge | null): e is ExtractedEdge => Boolean(e))
      .filter(
        (e: ExtractedEdge, idx: number, arr: ExtractedEdge[]) =>
          arr.findIndex((x) => x.from === e.from && x.to === e.to && x.type === e.type) === idx,
      );

    if (process.env.GM_NEO4J_DEBUG) {
      console.log("[gm-neo4j] parsed nodes=", nodes.length, "edges=", edges.length);
      console.log(JSON.stringify({ nodes, edges }, null, 2));
    }

    return { nodes, edges };
  }
}
