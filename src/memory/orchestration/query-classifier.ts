import { normalizeRecallText, tokenizeRecallText } from "../recall/query-analysis.ts";
import type {
  UnifiedQueryClassification,
  UnifiedQueryClassificationInput,
  UnifiedQueryRouteWeights,
  UnifiedRecallIntent,
  UnifiedRecallLayer,
  UnifiedSkillFamily,
} from "../types/orchestration.ts";

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "about",
  "what",
  "which",
  "when",
  "where",
  "一个",
  "这个",
  "那个",
  "怎么",
  "如何",
  "一下",
  "还有",
  "以及",
  "现在",
  "当时",
  "后来",
  "之前",
  "上次",
  "为什么",
  "如果",
  "按什么",
]);

const INTENT_PATTERNS: Record<UnifiedRecallIntent, RegExp[]> = {
  decision: [
    /(为什么这样设计|为什么这么设计|trade ?off|decision|架构决策|设计决策|怎么定的|为什么定成|为何采用|为什么.*兜底|为什么.*默认保留|为什么.*回退|为什么.*保留|为何.*回退|why.*fallback)/i,
  ],
  sop: [
    /(sop|runbook|playbook|步骤|流程|怎么做|怎么排查|操作手册|处理手册|标准流程|怎么回滚|如何回滚|怎么恢复|如何恢复|部署|发布|上线|安装|配置|启用|启动)/i,
  ],
  preference: [
    /(偏好|preference|prefer|默认.*倾向|默认.*喜欢|习惯|不喜欢|always|never|默认保留|默认走)/i,
  ],
  runtime: [/(现在.*状态|当前.*状态|runtime|运行时|刚刚|此刻|最新状态|目前怎样|signal|信号|实时)/i],
  history: [/(上次|之前|历史上|那次|最近一次|latest run|most recent|previous|以前怎么处理)/i],
  entity_lookup: [/(谁|哪一个|哪个文档|哪条记录|where is|lookup|是什么|是哪份|列出相关实体)/i],
  broad: [],
};

const SOURCE_CUES = {
  graph: /(graph|neo4j|关系|关联|链路|实体图谱|knowledge graph)/i,
  notebooklm:
    /(notebooklm|笔记|wiki|文档|知识库|经验库|经验卡片|research notebook|source pack|长期知识|长期经验)/i,
  nativeMemory: /(memory\.md|native memory|原生 memory|偏好|人设|长期记忆|习惯)/i,
  execution: /(执行|run|日志|trace|session|刚刚跑过|最近一次|处理链|runtime)/i,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function pushIntent(
  intent: UnifiedRecallIntent,
  scores: Map<UnifiedRecallIntent, number>,
  boost: number,
) {
  scores.set(intent, (scores.get(intent) ?? 0) + boost);
}

function extractQuotedHints(query: string): string[] {
  const matches = query.match(/["“”'‘’](.{2,40}?)["“”'‘’]/g) ?? [];
  return matches.map((item) => item.replace(/^["“”'‘’]|["“”'‘’]$/g, "").trim()).filter(Boolean);
}

function extractEntityHints(query: string, tokens: string[]): string[] {
  const quoted = extractQuotedHints(query);
  const special = tokens.filter(
    (token) =>
      token.includes("/") ||
      token.includes(".") ||
      token.includes("-") ||
      /[A-Z][a-zA-Z]+/.test(token) ||
      /[\u4e00-\u9fff]{2,}/.test(token),
  );
  const filtered = tokens.filter(
    (token) => token.length >= 3 && !STOPWORDS.has(token.toLowerCase()),
  );
  return unique([...quoted, ...special, ...filtered]).slice(0, 8);
}

function buildKeywords(tokens: string[]): string[] {
  return unique(
    tokens.filter((token) => token.length >= 2 && !STOPWORDS.has(token.toLowerCase())),
  ).slice(0, 10);
}

function normalizeWeights(weights: UnifiedQueryRouteWeights): UnifiedQueryRouteWeights {
  const total = weights.graph + weights.notebooklm + weights.nativeMemory + weights.execution;
  if (total <= 0) {
    return { graph: 0.25, notebooklm: 0.25, nativeMemory: 0.25, execution: 0.25 };
  }
  return {
    graph: Number((weights.graph / total).toFixed(4)),
    notebooklm: Number((weights.notebooklm / total).toFixed(4)),
    nativeMemory: Number((weights.nativeMemory / total).toFixed(4)),
    execution: Number((weights.execution / total).toFixed(4)),
  };
}

function rankIntents(scores: Map<UnifiedRecallIntent, number>): {
  intent: UnifiedRecallIntent;
  secondaryIntents: UnifiedRecallIntent[];
  confidence: number;
} {
  const ranked = [...scores.entries()].toSorted((a, b) => b[1] - a[1]);
  const winner = ranked[0] ?? ["broad" satisfies UnifiedRecallIntent, 0.4];
  const runnerUp = ranked[1];
  const confidence = clamp01(0.5 + winner[1] * 0.2 - (runnerUp?.[1] ?? 0) * 0.08);
  return {
    intent: winner[0],
    secondaryIntents: ranked
      .slice(1)
      .filter(([, score]) => score >= Math.max(0.9, winner[1] - 0.6))
      .map(([intent]) => intent)
      .slice(0, 3),
    confidence: Number(confidence.toFixed(3)),
  };
}

function buildWeights(intent: UnifiedRecallIntent, normalized: string): UnifiedQueryRouteWeights {
  const weights: UnifiedQueryRouteWeights = {
    graph: 0.25,
    notebooklm: 0.25,
    nativeMemory: 0.2,
    execution: 0.15,
  };

  switch (intent) {
    case "decision":
      weights.graph += 0.18;
      weights.notebooklm += 0.28;
      break;
    case "sop":
      weights.notebooklm += 0.35;
      weights.graph += 0.1;
      break;
    case "preference":
      weights.nativeMemory += 0.42;
      weights.notebooklm += 0.08;
      break;
    case "runtime":
      weights.graph += 0.2;
      weights.execution += 0.32;
      break;
    case "history":
      weights.execution += 0.32;
      weights.graph += 0.12;
      weights.notebooklm += 0.08;
      break;
    case "entity_lookup":
      weights.graph += 0.16;
      weights.notebooklm += 0.16;
      break;
    case "broad":
    default:
      break;
  }

  if (SOURCE_CUES.graph.test(normalized)) {
    weights.graph += 0.2;
  }
  if (SOURCE_CUES.notebooklm.test(normalized)) {
    weights.notebooklm += 0.24;
  }
  if (SOURCE_CUES.nativeMemory.test(normalized)) {
    weights.nativeMemory += 0.24;
  }
  if (SOURCE_CUES.execution.test(normalized)) {
    weights.execution += 0.24;
  }

  return normalizeWeights(weights);
}

function buildTargetLayers(intent: UnifiedRecallIntent, normalized: string): UnifiedRecallLayer[] {
  const layers = new Set<UnifiedRecallLayer>(["sources"]);
  if (intent === "decision" || /决策|architecture|trade ?off|why|为什么|为何/i.test(normalized)) {
    layers.add("key_decisions");
  }
  if (intent === "sop" || /sop|runbook|步骤|流程|排查|部署|发布|上线|安装|配置/i.test(normalized)) {
    layers.add("sop");
  }
  if (intent === "preference" || /偏好|prefer|习惯|默认/i.test(normalized)) {
    layers.add("preferences");
  }
  if (
    intent === "runtime" ||
    intent === "history" ||
    /状态|刚刚|最新|上次|之前|runtime|signal/i.test(normalized)
  ) {
    layers.add("runtime_signals");
  }

  if (intent === "broad" || intent === "entity_lookup") {
    layers.add("key_decisions");
    layers.add("runtime_signals");
  }

  return [...layers];
}

function buildTemporalHints(normalized: string): string[] {
  const hints: string[] = [];
  if (/(刚刚|现在|当前|最新|目前|recent|latest)/i.test(normalized)) {
    hints.push("recent");
  }
  if (/(上次|之前|历史|以前|past|history|previous)/i.test(normalized)) {
    hints.push("historical");
  }
  return hints;
}

function buildSkillFamily(
  intent: UnifiedRecallIntent,
  normalized: string,
): UnifiedSkillFamily | undefined {
  if (/(image|multimodal|audio|video|截图|图片|多模态)/i.test(normalized)) {
    return "multimodal";
  }
  if (/(deploy|release|发布|部署)/i.test(normalized)) {
    return "operations";
  }
  if (
    /(incident|outage|recover|restore|rollback|runtime|故障|异常|恢复|回滚|线上)/i.test(normalized)
  ) {
    return "incident";
  }
  switch (intent) {
    case "decision":
      return "architecture";
    case "sop":
      return "operations";
    case "preference":
      return "workspace-defaults";
    case "runtime":
    case "history":
      return "incident";
    default:
      return undefined;
  }
}

export function classifyUnifiedQuery(
  input: UnifiedQueryClassificationInput,
): UnifiedQueryClassification {
  const mergedContext = [input.query, ...(input.recentMessages ?? []).slice(-3)].join("\n");
  const normalizedQuery = normalizeRecallText(input.query);
  const normalizedContext = normalizeRecallText(mergedContext).toLowerCase();
  const tokens = tokenizeRecallText(normalizedQuery);
  const keywords = buildKeywords(tokens);
  const entityHints = extractEntityHints(normalizedQuery, tokens);

  const scores = new Map<UnifiedRecallIntent, number>([
    ["decision", 0.5],
    ["sop", 0.5],
    ["preference", 0.5],
    ["runtime", 0.5],
    ["history", 0.5],
    ["entity_lookup", 0.45],
    ["broad", 0.6],
  ]);

  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as Array<
    [UnifiedRecallIntent, RegExp[]]
  >) {
    if (patterns.some((pattern) => pattern.test(normalizedContext))) {
      pushIntent(intent, scores, 1.2);
    }
  }

  if (entityHints.length >= 2) {
    pushIntent("entity_lookup", scores, 0.35);
  }
  if (keywords.length >= 6) {
    pushIntent("broad", scores, 0.18);
  }
  if (
    /偏好|默认|always|never/i.test(normalizedContext) &&
    /怎么做|步骤|sop|runbook/i.test(normalizedContext)
  ) {
    pushIntent("preference", scores, 0.5);
    pushIntent("sop", scores, 0.35);
  }

  const { intent, secondaryIntents, confidence } = rankIntents(scores);
  const routeWeights = buildWeights(intent, normalizedContext);
  const targetLayers = buildTargetLayers(intent, normalizedContext);
  const temporalHints = buildTemporalHints(normalizedContext);
  const skillFamily = buildSkillFamily(intent, normalizedContext);

  const rationale = [
    `intent=${intent} confidence=${confidence.toFixed(2)}`,
    `layers=${targetLayers.join(",")}`,
    `route=graph:${routeWeights.graph.toFixed(2)} notebooklm:${routeWeights.notebooklm.toFixed(2)} native:${routeWeights.nativeMemory.toFixed(2)} execution:${routeWeights.execution.toFixed(2)}`,
  ];
  if (entityHints.length) {
    rationale.push(`entityHints=${entityHints.slice(0, 4).join(",")}`);
  }
  if (temporalHints.length) {
    rationale.push(`temporal=${temporalHints.join(",")}`);
  }

  return {
    query: input.query,
    normalizedQuery,
    intent,
    secondaryIntents,
    confidence,
    keywords,
    entityHints,
    temporalHints,
    routeWeights,
    targetLayers,
    skillFamily,
    rationale,
  };
}

export class UnifiedQueryClassifier {
  classify(input: UnifiedQueryClassificationInput): UnifiedQueryClassification {
    return classifyUnifiedQuery(input);
  }
}
