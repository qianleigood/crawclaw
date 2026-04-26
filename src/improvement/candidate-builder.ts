import {
  readExperienceIndexEntries,
  type ExperienceIndexEntry,
} from "../memory/experience/index-store.ts";
import type {
  PromotionCandidate,
  PromotionCandidateAssessment,
  PromotionEvidenceKind,
} from "./types.js";

const PROMOTION_INTENT_PATTERN =
  /以后都这样做|以后默认这样做|之后都这样做|going forward|default to this/i;
const DURABLE_PREFERENCE_PATTERN =
  /(user preference|feedback memory|durable memory|偏好|习惯|回答方式|协作偏好|记住这个偏好)/i;
const TEMPORARY_PATTERN = /(临时|暂时|一次性|temporary|workaround|hotfix only)/i;
const UNVERIFIED_PATTERN = /(猜测|未经验证|未验证|speculation|unverified|guess)/i;

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

function extractEvidenceKinds(entry: ExperienceIndexEntry): PromotionEvidenceKind[] {
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

function shouldIgnoreEntry(entry: ExperienceIndexEntry): boolean {
  const text = [entry.title, entry.summary, entry.content].join("\n");
  return (
    DURABLE_PREFERENCE_PATTERN.test(text) ||
    TEMPORARY_PATTERN.test(text) ||
    UNVERIFIED_PATTERN.test(text)
  );
}

function buildClusterKey(entry: ExperienceIndexEntry): string {
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

export async function buildPromotionCandidateAssessments(params?: {
  entries?: ExperienceIndexEntry[];
  limit?: number;
}): Promise<PromotionCandidateAssessment[]> {
  const entries = params?.entries ?? (await readExperienceIndexEntries(params?.limit ?? 200));
  const eligible = entries.filter((entry) => !shouldIgnoreEntry(entry));
  const groups = new Map<string, ExperienceIndexEntry[]>();

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
