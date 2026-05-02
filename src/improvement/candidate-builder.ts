import type { CrawClawConfig } from "../config/config.js";
import { normalizeNotebookLmConfig } from "../memory/config/notebooklm.ts";
import {
  readExperienceOutboxEntries,
  type ExperienceOutboxEntry,
} from "../memory/experience/outbox-store.ts";
import { searchNotebookLmViaCli } from "../memory/notebooklm/notebooklm-cli.ts";
import type { NotebookLmConfigInput } from "../memory/types/config.ts";
import type { UnifiedRecallItem } from "../memory/types/orchestration.ts";
import type {
  PromotionCandidate,
  PromotionCandidateAssessment,
  PromotionEvidenceKind,
  PromotionSourceRef,
} from "./types.js";

const PROMOTION_INTENT_PATTERN =
  /以后都这样做|以后默认这样做|之后都这样做|going forward|default to this/i;
const DURABLE_PREFERENCE_PATTERN =
  /(user preference|feedback memory|durable memory|偏好|习惯|回答方式|协作偏好|记住这个偏好)/i;
const TEMPORARY_PATTERN = /(临时|暂时|一次性|temporary|workaround|hotfix only)/i;
const UNVERIFIED_PATTERN = /(猜测|未经验证|未验证|speculation|unverified|guess)/i;
const VALID_EVIDENCE_KINDS: PromotionEvidenceKind[] = ["trigger", "action", "result", "validation"];

type NotebookLmSearch = typeof searchNotebookLmViaCli;
type RuntimeLogger = { warn(message: string): void };

type CandidateBuilderParams = {
  entries?: ExperienceOutboxEntry[];
  limit?: number;
  config?: CrawClawConfig;
  searchNotebookLm?: NotebookLmSearch;
  logger?: RuntimeLogger;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeIdentity(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function extractSection(content: string, heading: string): string[] {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`^## ${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^##\\s|\\Z)`, "m"),
  );
  if (!match?.[1]) {
    return [];
  }
  return match[1]
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

function latestLine(lines: string[]): string | undefined {
  return lines.map(normalizeWhitespace).find(Boolean);
}

function uniqueLines(lines: string[]): string[] {
  return [...new Set(lines.map(normalizeWhitespace).filter(Boolean))];
}

function extractEvidenceKinds(entry: ExperienceOutboxEntry): PromotionEvidenceKind[] {
  const trigger = extractSection(entry.content, "触发信号");
  const actions = extractSection(entry.content, "有效做法");
  const result = extractSection(entry.content, "结果");
  const validation = extractSection(entry.content, "验证 / 证据");
  const kinds: PromotionEvidenceKind[] = [];
  if (trigger.length > 0) {
    kinds.push("trigger");
  }
  if (actions.length > 0) {
    kinds.push("action");
  }
  if (result.length > 0) {
    kinds.push("result");
  }
  if (validation.length > 0) {
    kinds.push("validation");
  }
  return kinds;
}

function shouldIgnoreEntry(entry: ExperienceOutboxEntry): boolean {
  const text = [entry.title, entry.summary, entry.content].join("\n");
  return (
    DURABLE_PREFERENCE_PATTERN.test(text) ||
    TEMPORARY_PATTERN.test(text) ||
    UNVERIFIED_PATTERN.test(text)
  );
}

function buildClusterKey(entry: ExperienceOutboxEntry): string {
  const actions = extractSection(entry.content, "有效做法");
  const lesson = extractSection(entry.content, "经验结论");
  const anchor = latestLine(actions) ?? latestLine(lesson) ?? entry.summary;
  return normalizeIdentity(`${entry.type}:${anchor}`);
}

function sortAssessments(
  left: PromotionCandidateAssessment,
  right: PromotionCandidateAssessment,
): number {
  return right.score - left.score || right.candidate.lastSeenAt - left.candidate.lastSeenAt;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueLines(value.filter((item): item is string => typeof item === "string"));
}

function readPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function normalizeReuseLevel(value: unknown): PromotionCandidate["currentReuseLevel"] {
  return value === "none" || value === "experience" || value === "skill" || value === "workflow"
    ? value
    : "experience";
}

function normalizeEvidenceKinds(value: unknown): PromotionEvidenceKind[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueLines(value.filter((item): item is string => typeof item === "string")).filter(
    (kind): kind is PromotionEvidenceKind =>
      kind === "trigger" || kind === "action" || kind === "result" || kind === "validation",
  );
}

function normalizeSourceRefs(value: unknown, item: UnifiedRecallItem): PromotionSourceRef[] {
  const refs: PromotionSourceRef[] = [];
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (!isRecord(raw)) {
        continue;
      }
      const kind =
        raw.kind === "context_archive" || raw.kind === "workflow_run" ? raw.kind : "experience";
      const ref = readString(raw.ref);
      if (ref) {
        refs.push({ kind, ref });
      }
    }
  }
  if (refs.length > 0) {
    return refs;
  }
  return [
    {
      kind: "experience",
      ref: item.sourceRef ?? item.id,
    },
  ];
}

function extractJsonCandidatePayloads(text: string | undefined): unknown[] {
  const trimmed = text?.trim();
  if (!trimmed) {
    return [];
  }
  const candidates = [trimmed];
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) =>
    match[1]?.trim(),
  );
  candidates.push(...fenced.filter((value): value is string => Boolean(value)));
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (isRecord(parsed) && Array.isArray(parsed.candidates)) {
        return parsed.candidates;
      }
      if (isRecord(parsed) && isRecord(parsed.candidate)) {
        return [parsed.candidate];
      }
    } catch {
      // Keep trying less precise JSON spans below.
    }
  }
  return [];
}

function assessmentFromNotebookLmCandidate(
  raw: unknown,
  item: UnifiedRecallItem,
  now: number,
): PromotionCandidateAssessment | null {
  if (!isRecord(raw)) {
    return null;
  }
  const signalSummary =
    readString(raw.signalSummary) ?? readString(raw.summary) ?? readString(item.summary);
  if (!signalSummary) {
    return null;
  }
  const repeatedActions = readStringArray(raw.repeatedActions ?? raw.actions);
  const validationEvidence = readStringArray(raw.validationEvidence ?? raw.evidence);
  const evidenceKinds =
    normalizeEvidenceKinds(raw.evidenceKinds).length > 0
      ? normalizeEvidenceKinds(raw.evidenceKinds)
      : VALID_EVIDENCE_KINDS.filter((kind) => {
          if (kind === "trigger") {
            return Boolean(readString(raw.triggerPattern));
          }
          if (kind === "action") {
            return repeatedActions.length > 0;
          }
          return validationEvidence.length > 0;
        });
  const blockers = readStringArray(raw.blockers);
  const baselineDecision =
    raw.baselineDecision === "ready" || raw.baselineDecision === "needs_more_evidence"
      ? raw.baselineDecision
      : blockers.length === 0 && evidenceKinds.length >= 3
        ? "ready"
        : "needs_more_evidence";
  const id =
    readString(raw.id) ??
    `notebooklm-candidate:${slugifyCandidateId(readString(raw.triggerPattern) ?? signalSummary)}`;
  const candidate: PromotionCandidate = {
    id,
    sourceRefs: normalizeSourceRefs(raw.sourceRefs, item),
    signalSummary,
    observedFrequency: readPositiveNumber(raw.observedFrequency, 1),
    currentReuseLevel: normalizeReuseLevel(raw.currentReuseLevel),
    ...(readString(raw.triggerPattern) ? { triggerPattern: readString(raw.triggerPattern) } : {}),
    repeatedActions,
    validationEvidence,
    firstSeenAt: readPositiveNumber(raw.firstSeenAt, item.updatedAt ?? now),
    lastSeenAt: readPositiveNumber(raw.lastSeenAt, item.updatedAt ?? now),
  };
  return {
    candidate,
    evidenceKinds,
    baselineDecision,
    blockers,
    score: readPositiveNumber(
      raw.score,
      candidate.observedFrequency * 10 + evidenceKinds.length * 3 - blockers.length * 4,
    ),
  };
}

function slugifyCandidateId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff_-]+/giu, "-")
      .replace(/^-+|-+$/g, "") || "candidate"
  );
}

function buildNotebookLmImprovementQuery(limit: number): string {
  return [
    "请从 CrawClaw NotebookLM 经验库中找可晋升为自进化提案的重复经验。",
    "只返回已经有可复用动作和验证证据的候选；不要返回用户偏好、一次性临时修复或未验证猜测。",
    "请返回严格 JSON，不要 Markdown，不要解释文字。",
    "JSON 结构：",
    '{"candidates":[{"id":"notebooklm-candidate:<slug>","sourceRefs":[{"kind":"experience","ref":"<note-or-source-id>"}],"signalSummary":"...","observedFrequency":2,"currentReuseLevel":"experience","triggerPattern":"...","repeatedActions":["..."],"validationEvidence":["..."],"evidenceKinds":["trigger","action","result","validation"],"baselineDecision":"ready","blockers":[],"score":30}]}',
    `最多返回 ${Math.max(1, Math.min(limit, 10))} 个候选，按可晋升价值从高到低排序。`,
  ].join("\n");
}

async function buildNotebookLmCandidateAssessments(params: {
  config: CrawClawConfig;
  limit: number;
  searchNotebookLm?: NotebookLmSearch;
  logger?: RuntimeLogger;
}): Promise<PromotionCandidateAssessment[]> {
  const notebooklm = normalizeNotebookLmConfig(
    params.config.memory?.notebooklm as NotebookLmConfigInput | undefined,
  );
  if (!notebooklm.enabled || !notebooklm.cli.enabled) {
    return [];
  }
  const search = params.searchNotebookLm ?? searchNotebookLmViaCli;
  const items = await search({
    config: notebooklm,
    query: buildNotebookLmImprovementQuery(params.limit),
    limit: params.limit,
    logger: params.logger,
  });
  const now = Date.now();
  return items
    .flatMap((item) =>
      [
        ...extractJsonCandidatePayloads(item.content),
        ...extractJsonCandidatePayloads(item.summary),
      ].map((raw) => assessmentFromNotebookLmCandidate(raw, item, now)),
    )
    .filter((assessment): assessment is PromotionCandidateAssessment => Boolean(assessment))
    .toSorted(sortAssessments);
}

async function buildLocalPromotionCandidateAssessments(params?: {
  entries?: ExperienceOutboxEntry[];
  limit?: number;
}): Promise<PromotionCandidateAssessment[]> {
  const entries = params?.entries ?? (await readExperienceOutboxEntries(params?.limit ?? 200));
  const eligible = entries.filter((entry) => !shouldIgnoreEntry(entry));
  const groups = new Map<string, ExperienceOutboxEntry[]>();

  for (const entry of eligible) {
    const key = buildClusterKey(entry);
    if (!key) {
      continue;
    }
    const existing = groups.get(key) ?? [];
    existing.push(entry);
    groups.set(key, existing);
  }

  const assessments: PromotionCandidateAssessment[] = [];
  for (const [key, group] of groups.entries()) {
    if (group.length === 0) {
      continue;
    }
    const sorted = group.toSorted((left, right) => right.updatedAt - left.updatedAt);
    const latest = sorted[0];
    if (!latest) {
      continue;
    }
    const repeatedActions = uniqueLines(
      group.flatMap((entry) => extractSection(entry.content, "有效做法")),
    );
    const validationEvidence = uniqueLines(
      group.flatMap((entry) => [
        ...extractSection(entry.content, "验证 / 证据"),
        ...extractSection(entry.content, "结果"),
      ]),
    );
    const triggerLines = uniqueLines(
      group.flatMap((entry) => extractSection(entry.content, "触发信号")),
    );
    const evidenceKinds = uniqueLines(group.flatMap((entry) => extractEvidenceKinds(entry))).filter(
      (kind): kind is PromotionEvidenceKind =>
        kind === "trigger" || kind === "action" || kind === "result" || kind === "validation",
    );
    const explicitPromotionIntent = group.some((entry) =>
      PROMOTION_INTENT_PATTERN.test([entry.title, entry.summary, entry.content].join("\n")),
    );
    const blockers: string[] = [];
    if (group.length < 2 && !explicitPromotionIntent) {
      continue;
    }
    if (evidenceKinds.length < 3) {
      blockers.push("insufficient_evidence_kinds");
    }
    if (!evidenceKinds.includes("result") && !evidenceKinds.includes("validation")) {
      blockers.push("missing_result_or_validation_evidence");
    }
    const candidate: PromotionCandidate = {
      id: `promotion-candidate:${key.replace(/[^a-z0-9\u4e00-\u9fff_-]+/giu, "-")}`,
      sourceRefs: group.map((entry) => ({
        kind: "experience",
        ref: entry.noteId ?? entry.id,
      })),
      signalSummary: normalizeWhitespace(latest.summary),
      observedFrequency: group.length,
      currentReuseLevel: "experience",
      ...(latestLine(triggerLines) ? { triggerPattern: latestLine(triggerLines) } : {}),
      repeatedActions,
      validationEvidence,
      firstSeenAt: Math.min(...group.map((entry) => entry.updatedAt)),
      lastSeenAt: Math.max(...group.map((entry) => entry.updatedAt)),
    };
    assessments.push({
      candidate,
      evidenceKinds,
      baselineDecision: blockers.length === 0 ? "ready" : "needs_more_evidence",
      blockers,
      score: group.length * 10 + evidenceKinds.length * 3 - blockers.length * 4,
    });
  }

  return assessments.toSorted(sortAssessments);
}

export async function buildPromotionCandidateAssessments(
  params?: CandidateBuilderParams,
): Promise<PromotionCandidateAssessment[]> {
  if (params?.entries) {
    return await buildLocalPromotionCandidateAssessments(params);
  }
  if (!params?.config) {
    return [];
  }
  return await buildNotebookLmCandidateAssessments({
    config: params.config,
    limit: params.limit ?? 5,
    searchNotebookLm: params.searchNotebookLm,
    logger: params.logger,
  });
}
