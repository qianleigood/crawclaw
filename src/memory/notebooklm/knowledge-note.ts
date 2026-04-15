export type KnowledgeNoteType = "procedure" | "decision" | "runtime_pattern" | "reference";

export interface KnowledgeNoteWriteInput {
  type: KnowledgeNoteType;
  title: string;
  summary: string;
  body?: string;
  why?: string;
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

const TYPE_LABELS: Record<KnowledgeNoteType, string> = {
  procedure: "操作流程",
  decision: "决策说明",
  runtime_pattern: "运行规律",
  reference: "参考资料",
};

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeBlockLines(lines?: string[]): string[] {
  return uniqueStrings(lines ?? []).flatMap((line) => {
    const normalized = line.replace(/\s+/g, " ").trim();
    return normalized ? [normalized] : [];
  });
}

function renderParagraph(label: string, value?: string): string[] {
  const trimmed = value?.trim();
  if (!trimmed) {return [];}
  return [label, trimmed];
}

function renderBulletSection(heading: string, items?: string[]): string[] {
  const lines = normalizeBlockLines(items);
  if (!lines.length) {return [];}
  return [heading, ...lines.map((item) => `- ${item}`)];
}

function hasChinese(value: string | null | undefined): boolean {
  return /[\u4e00-\u9fff]/.test(value ?? "");
}

export function normalizeKnowledgeNoteType(value: string | null | undefined): KnowledgeNoteType | null {
  return value === "procedure"
    || value === "decision"
    || value === "runtime_pattern"
    || value === "reference"
    ? value
    : null;
}

export function getKnowledgeNoteTypeLabel(type: KnowledgeNoteType): string {
  return TYPE_LABELS[type];
}

export function renderKnowledgeNoteMarkdown(input: KnowledgeNoteWriteInput): string {
  const title = input.title.trim();
  const summary = input.summary.trim();
  const sections: string[] = [
    `# ${title}`,
    "",
    `> 类型：${TYPE_LABELS[input.type]}`,
    `> 摘要：${summary}`,
  ];

  if (input.aliases?.length) {
    sections.push(`> 别名：${normalizeBlockLines(input.aliases).join("、")}`);
  }
  if (input.tags?.length) {
    sections.push(`> 标签：${normalizeBlockLines(input.tags).join("、")}`);
  }

  sections.push("");

  if (input.type === "procedure") {
    sections.push(
      ...renderParagraph("## 适用场景", input.body),
      ...renderBulletSection("## 操作步骤", input.steps),
      ...renderBulletSection("## 验证方法", input.validation),
    );
    if (input.why?.trim()) {
      sections.push("## 说明", input.why.trim());
    }
    if (input.references?.length) {
      sections.push(...renderBulletSection("## 参考来源", input.references));
    }
  } else if (input.type === "decision") {
    sections.push(
      ...renderParagraph("## 结论", input.body),
      ...renderParagraph("## 原因", input.why),
      ...renderBulletSection("## 影响", input.consequences),
    );
    if (input.whenToRevisit?.trim()) {
      sections.push("## 何时重新评估", input.whenToRevisit.trim());
    }
  } else if (input.type === "runtime_pattern") {
    sections.push(
      ...renderParagraph("## 现象", input.body),
      ...renderBulletSection("## 常见信号", input.signals),
      ...renderBulletSection("## 常见处理", input.steps),
      ...renderBulletSection("## 参考来源", input.references),
    );
    if (input.why?.trim()) {
      sections.push("## 判断依据", input.why.trim());
    }
  } else if (input.type === "reference") {
    sections.push(
      ...renderParagraph("## 资料说明", input.body),
      ...renderBulletSection("## 使用场景", input.steps),
      ...renderBulletSection("## 入口 / 定位方式", input.references),
    );
    if (input.why?.trim()) {
      sections.push("## 备注", input.why.trim());
    }
  }

  sections.push(
    "",
    "## 元信息",
    `- 知识类型：${TYPE_LABELS[input.type]}`,
    `- 知识键：${input.dedupeKey?.trim() || title}`,
  );

  if (input.tags?.length) {
    sections.push(`- 标签：${normalizeBlockLines(input.tags).join("、")}`);
  }
  if (input.aliases?.length) {
    sections.push(`- 别名：${normalizeBlockLines(input.aliases).join("、")}`);
  }

  return sections.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function classifyKnowledgeNoteGuardIssue(input: KnowledgeNoteWriteInput): string | null {
  const text = [
    input.title,
    input.summary,
    input.body,
    input.why,
    input.whenToRevisit,
    ...(input.steps ?? []),
    ...(input.validation ?? []),
    ...(input.signals ?? []),
    ...(input.references ?? []),
    ...(input.consequences ?? []),
  ]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {return "knowledge note content required";}

  if (!hasChinese(input.title) || !hasChinese(input.summary)) {
    return "knowledge note title and summary must be Chinese-first for readability";
  }

  const substantiveFields = [
    input.body,
    input.why,
    input.whenToRevisit,
    ...(input.steps ?? []),
    ...(input.validation ?? []),
    ...(input.signals ?? []),
    ...(input.references ?? []),
    ...(input.consequences ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (substantiveFields.some((value) => /[A-Za-z]/.test(value) && !hasChinese(value))) {
    return "knowledge note body and structured sections must remain Chinese-readable";
  }

  if (
    /(current task|todo|next step|working on|in progress|temporary plan|current session|session memory|current turn|afterturn|prompt|context window|临时计划|当前任务|进行中|接下来要做|会话状态|当前会话)/i
      .test(text)
  ) {
    return "knowledge note should not store transient session state";
  }

  if (
    /(user preference|feedback memory|durable memory|偏好|习惯|回答方式|协作偏好|用户要求|记住这个偏好)/i
      .test(text)
  ) {
    return "knowledge note should not store durable-memory style user or feedback context";
  }

  if (
    /(SKILL\.md|available_skills|本地技能|可执行能力|tool call|工具调用|技能目录)/i.test(text)
  ) {
    return "knowledge note should not define or impersonate executable skills";
  }

  if (/(临时|暂时|一次性|临时修复|workaround|hotfix only)/i.test(text)) {
    return "knowledge note should capture stable knowledge, not temporary fixes";
  }

  if (
    /(assistant:|user:|system:|tool:|```|^>\s*user|^>\s*assistant)/im.test(text)
  ) {
    return "knowledge note should not store transcript fragments";
  }

  return null;
}
