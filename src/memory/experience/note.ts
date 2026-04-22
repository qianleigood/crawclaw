export type ExperienceNoteType =
  | "procedure"
  | "decision"
  | "runtime_pattern"
  | "failure_pattern"
  | "workflow_pattern"
  | "reference";

export interface ExperienceNoteWriteInput {
  type: ExperienceNoteType;
  title: string;
  summary: string;
  context?: string;
  trigger?: string;
  action?: string;
  result?: string;
  lesson?: string;
  appliesWhen?: string;
  avoidWhen?: string;
  evidence?: string[];
  confidence?: "low" | "medium" | "high";
  steps?: string[];
  validation?: string[];
  signals?: string[];
  references?: string[];
  consequences?: string[];
  whenToRevisit?: string;
  aliases?: string[];
  tags?: string[];
  dedupeKey?: string;
}

const TYPE_LABELS: Record<ExperienceNoteType, string> = {
  procedure: "操作经验",
  decision: "决策经验",
  runtime_pattern: "运行经验",
  failure_pattern: "失败经验",
  workflow_pattern: "协作经验",
  reference: "参考资料",
};

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeBlockLines(lines?: Array<string | undefined | null>): string[] {
  return uniqueStrings(lines ?? []).flatMap((line) => {
    const normalized = line.replace(/\s+/g, " ").trim();
    return normalized ? [normalized] : [];
  });
}

function renderParagraph(label: string, value?: string): string[] {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }
  return [label, trimmed];
}

function renderBulletSection(heading: string, items?: string[]): string[] {
  const lines = normalizeBlockLines(items);
  if (!lines.length) {
    return [];
  }
  return [heading, ...lines.map((item) => `- ${item}`)];
}

function hasChinese(value: string | null | undefined): boolean {
  return /[\u4e00-\u9fff]/.test(value ?? "");
}

function mergeEvidence(input: ExperienceNoteWriteInput): string[] {
  return normalizeBlockLines([
    ...(input.evidence ?? []),
    ...(input.validation ?? []),
    ...(input.references ?? []),
  ]);
}

function renderExperienceBody(input: ExperienceNoteWriteInput): string[] {
  const actionLines = normalizeBlockLines([input.action, ...(input.steps ?? [])]);
  const triggerLines = normalizeBlockLines([input.trigger, ...(input.signals ?? [])]);
  const evidence = mergeEvidence(input);

  return [
    ...renderParagraph("## 场景", input.context),
    ...renderBulletSection("## 触发信号", triggerLines),
    ...renderBulletSection("## 有效做法", actionLines),
    ...renderParagraph("## 结果", input.result),
    ...renderParagraph("## 经验结论", input.lesson),
    ...renderParagraph("## 适用边界", input.appliesWhen),
    ...renderParagraph("## 不适用 / 避免", input.avoidWhen),
    ...renderBulletSection("## 验证 / 证据", evidence),
    ...renderBulletSection("## 影响", input.consequences),
    ...renderParagraph("## 何时重新评估", input.whenToRevisit),
  ];
}

export function normalizeExperienceNoteType(
  value: string | null | undefined,
): ExperienceNoteType | null {
  return value === "procedure" ||
    value === "decision" ||
    value === "runtime_pattern" ||
    value === "failure_pattern" ||
    value === "workflow_pattern" ||
    value === "reference"
    ? value
    : null;
}

export function normalizeExperienceConfidence(
  value: string | null | undefined,
): ExperienceNoteWriteInput["confidence"] | undefined {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
}

export function getExperienceNoteTypeLabel(type: ExperienceNoteType): string {
  return TYPE_LABELS[type];
}

export function renderExperienceNoteMarkdown(input: ExperienceNoteWriteInput): string {
  const title = input.title.trim();
  const summary = input.summary.trim();
  const sections: string[] = [
    `# ${title}`,
    "",
    `> 经验类型：${TYPE_LABELS[input.type]}`,
    `> 摘要：${summary}`,
  ];

  if (input.confidence) {
    sections.push(`> 置信度：${input.confidence}`);
  }
  if (input.aliases?.length) {
    sections.push(`> 别名：${normalizeBlockLines(input.aliases).join("、")}`);
  }
  if (input.tags?.length) {
    sections.push(`> 标签：${normalizeBlockLines(input.tags).join("、")}`);
  }

  sections.push("", ...renderExperienceBody(input));

  sections.push(
    "",
    "## 元信息",
    `- 经验类型：${TYPE_LABELS[input.type]}`,
    `- 经验键：${input.dedupeKey?.trim() || title}`,
  );

  if (input.confidence) {
    sections.push(`- 置信度：${input.confidence}`);
  }
  if (input.tags?.length) {
    sections.push(`- 标签：${normalizeBlockLines(input.tags).join("、")}`);
  }
  if (input.aliases?.length) {
    sections.push(`- 别名：${normalizeBlockLines(input.aliases).join("、")}`);
  }

  return sections
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function collectSubstantiveFields(input: ExperienceNoteWriteInput): string[] {
  return [
    input.context,
    input.trigger,
    input.action,
    input.result,
    input.lesson,
    input.appliesWhen,
    input.avoidWhen,
    input.whenToRevisit,
    ...(input.steps ?? []),
    ...(input.validation ?? []),
    ...(input.signals ?? []),
    ...(input.references ?? []),
    ...(input.consequences ?? []),
    ...(input.evidence ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function classifyExperienceNoteGuardIssue(input: ExperienceNoteWriteInput): string | null {
  const substantiveFields = collectSubstantiveFields(input);
  const text = [input.title, input.summary, ...substantiveFields].filter(Boolean).join("\n").trim();

  if (!text) {
    return "experience note content required";
  }

  if (!hasChinese(input.title) || !hasChinese(input.summary)) {
    return "experience note title and summary must be Chinese-first for readability";
  }

  if (substantiveFields.some((value) => /[A-Za-z]/.test(value) && !hasChinese(value))) {
    return "experience note structured sections must remain Chinese-readable";
  }

  if (
    input.type !== "reference" &&
    ![
      input.context,
      input.trigger,
      input.action,
      input.result,
      input.lesson,
      input.appliesWhen,
      ...(input.steps ?? []),
      ...(input.signals ?? []),
      ...(input.evidence ?? []),
    ].some((value) => value?.trim())
  ) {
    return "experience note should include context, trigger, action, result, or lesson";
  }

  if (
    /(current task|todo|next step|working on|in progress|temporary plan|current session|session memory|current turn|afterturn|prompt|context window|临时计划|当前任务|进行中|接下来要做|会话状态|当前会话)/i.test(
      text,
    )
  ) {
    return "experience note should not store transient session state";
  }

  if (
    /(user preference|feedback memory|durable memory|偏好|习惯|回答方式|协作偏好|记住这个偏好)/i.test(
      text,
    )
  ) {
    return "experience note should not store durable-memory style user or feedback context";
  }

  if (/(SKILL\.md|available_skills|本地技能|可执行能力|tool call|工具调用|技能目录)/i.test(text)) {
    return "experience note should not define or impersonate executable skills";
  }

  if (/(临时|暂时|一次性|临时修复|workaround|hotfix only)/i.test(text)) {
    return "experience note should capture reusable experience, not temporary fixes";
  }

  if (/(猜测|未经验证|未验证|可能也许|speculation|unverified|guess)/i.test(text)) {
    return "experience note should capture validated experience, not unverified guesses";
  }

  if (/(assistant:|user:|system:|tool:|```|^>\s*user|^>\s*assistant)/im.test(text)) {
    return "experience note should not store transcript fragments";
  }

  return null;
}
