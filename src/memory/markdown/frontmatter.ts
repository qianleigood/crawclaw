export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export type FrontmatterMap = Record<string, FrontmatterValue>;

export interface FrontmatterParseResult {
  frontmatter: FrontmatterMap;
  body: string;
  rawFrontmatter?: string;
}

function parseInlineArray(value: string): FrontmatterValue[] {
  const inner = value.trim().replace(/^\[/, "").replace(/\]$/, "").trim();
  if (!inner) {return [];}
  return inner
    .split(",")
    .map((item) => parseScalar(item.trim()))
    .filter((item) => item !== undefined);
}

function parseScalar(value: string): FrontmatterValue | undefined {
  const trimmed = value.trim();
  if (!trimmed) {return "";}
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") {return true;}
  if (trimmed === "false") {return false;}
  if (trimmed === "null") {return null;}
  if (trimmed === "[]") {return [];}
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {return parseInlineArray(trimmed);}
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {return Number(trimmed);}
  return trimmed;
}

function parseBlock(lines: string[]): FrontmatterMap {
  const frontmatter: FrontmatterMap = {};

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i] ?? "";
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {continue;}

    const match = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(rawLine);
    if (!match) {continue;}

    const [, key, rawValue = ""] = match;
    const value = rawValue.trim();
    if (value) {
      frontmatter[key] = parseScalar(value) ?? value;
      continue;
    }

    const list: FrontmatterValue[] = [];
    let cursor = i + 1;
    while (cursor < lines.length) {
      const candidate = lines[cursor] ?? "";
      const trimmed = candidate.trim();
      if (!trimmed) {
        cursor += 1;
        continue;
      }
      if (!/^\s+-\s+/.test(candidate)) {break;}
      list.push(parseScalar(trimmed.replace(/^-\s+/, "")) ?? trimmed.replace(/^-\s+/, ""));
      cursor += 1;
    }

    if (list.length) {
      frontmatter[key] = list;
      i = cursor - 1;
    } else {
      frontmatter[key] = "";
    }
  }

  return frontmatter;
}

export function parseMarkdownFrontmatter(markdown: string): FrontmatterParseResult {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }

  const lines = normalized.split("\n");
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i] ?? "")) {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex < 0) {
    return { frontmatter: {}, body: normalized };
  }

  const rawFrontmatter = lines.slice(1, closingIndex).join("\n");
  const body = lines.slice(closingIndex + 1).join("\n");
  return {
    frontmatter: parseBlock(lines.slice(1, closingIndex)),
    body,
    rawFrontmatter,
  };
}
