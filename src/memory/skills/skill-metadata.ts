import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  SkillIndex,
  SkillMetadata,
  UnifiedRecallIntent,
  UnifiedRecallLayer,
  UnifiedSkillFamily,
} from "../types/orchestration.ts";
import { validateSkillFrontmatter } from "./skill-frontmatter-schema.ts";

const DEFAULT_MAX_SKILL_FILE_BYTES = 256_000;
const DEFAULT_MAX_SKILLS_PER_ROOT = 200;

function compactWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => compactWhitespace(item)).filter(Boolean);
  }
  const normalized = typeof value === "string" ? compactWhitespace(value) : "";
  if (!normalized) return [];
  if (!normalized.includes(",")) return [normalized];
  return normalized.split(",").map((item) => compactWhitespace(item)).filter(Boolean);
}

function readFrontmatter(filePath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return {};
    const record: Record<string, unknown> = {};
    let currentArrayKey: string | null = null;
    let currentObjectKey: string | null = null;
    let currentObject: Record<string, unknown> | null = null;
    for (const line of match[1].split("\n")) {
      const nestedScalarMatch = line.match(/^\s{2,}([A-Za-z0-9_-]+):\s*(.*)\s*$/);
      if (nestedScalarMatch && currentObjectKey && currentObject) {
        const [, key, rawValue] = nestedScalarMatch;
        const normalized = compactWhitespace(rawValue.replace(/^["']|["']$/g, ""));
        if (!normalized) {
          currentObject[key] = [];
          continue;
        }
        if (normalized.startsWith("[") && normalized.endsWith("]")) {
          currentObject[key] = normalized
            .slice(1, -1)
            .split(",")
            .map((item) => compactWhitespace(item.replace(/^["']|["']$/g, "")))
            .filter(Boolean);
          continue;
        }
        currentObject[key] = normalized;
        continue;
      }
      const arrayMatch = line.match(/^\s*-\s+(.+)\s*$/);
      if (arrayMatch && currentArrayKey) {
        const target = currentObject ?? record;
        const prior = target[currentArrayKey];
        const next = Array.isArray(prior) ? prior : [];
        next.push(compactWhitespace(arrayMatch[1]));
        target[currentArrayKey] = next;
        continue;
      }
      const scalarMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)\s*$/);
      if (!scalarMatch) {
        currentArrayKey = null;
        currentObjectKey = null;
        currentObject = null;
        continue;
      }
      const [, key, rawValue] = scalarMatch;
      currentArrayKey = key;
      currentObjectKey = null;
      currentObject = null;
      const normalized = compactWhitespace(rawValue.replace(/^["']|["']$/g, ""));
      if (!normalized) {
        record[key] = {};
        currentObjectKey = key;
        currentObject = record[key] as unknown as Record<string, string | string[]>;
        continue;
      }
      if (normalized.startsWith("[") && normalized.endsWith("]")) {
        record[key] = normalized
          .slice(1, -1)
          .split(",")
          .map((item) => compactWhitespace(item.replace(/^["']|["']$/g, "")))
          .filter(Boolean);
        continue;
      }
      record[key] = normalized;
    }
    return record;
  } catch {
    return {};
  }
}

function readSkillBodyDescription(filePath: string): string {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const lines = body
      .split("\n")
      .map((line) => compactWhitespace(line.replace(/^#+\s*/, "")))
      .filter(Boolean);
    return lines.find((line) => line.length >= 16) ?? lines[0] ?? "";
  } catch {
    return "";
  }
}

function inferFamily(text: string): UnifiedSkillFamily {
  if (/(incident|outage|rollback|runtime|recover|restore|故障|恢复|回滚|异常)/i.test(text)) return "incident";
  if (/(sop|runbook|deploy|release|ops|debug|troubleshoot|排查|操作|流程|运维)/i.test(text)) return "operations";
  if (/(architecture|design|decision|trade ?off|架构|设计|决策)/i.test(text)) return "architecture";
  if (/(preference|default|workspace|repo|style|习惯|默认|偏好)/i.test(text)) return "workspace-defaults";
  if (/(image|multimodal|audio|video|视觉|多模态)/i.test(text)) return "multimodal";
  return "other";
}

function inferIntents(text: string, family: UnifiedSkillFamily): UnifiedRecallIntent[] {
  const intents = new Set<UnifiedRecallIntent>();
  if (family === "architecture" || /(decision|why|trade ?off|架构|设计|为什么)/i.test(text)) intents.add("decision");
  if (family === "operations" || /(sop|steps|runbook|how to|步骤|流程|排查)/i.test(text)) intents.add("sop");
  if (family === "workspace-defaults" || /(default|preference|always|never|默认|偏好)/i.test(text)) intents.add("preference");
  if (family === "incident" || /(runtime|incident|latest|recent|运行时|最近|故障)/i.test(text)) intents.add("runtime");
  if (/(history|postmortem|previous|上次|历史)/i.test(text)) intents.add("history");
  if (/(lookup|entity|where is|是什么|哪一个)/i.test(text)) intents.add("entity_lookup");
  if (!intents.size) intents.add("broad");
  return [...intents];
}

function inferLayers(text: string, family: UnifiedSkillFamily): UnifiedRecallLayer[] {
  const layers = new Set<UnifiedRecallLayer>();
  if (family === "architecture" || /(decision|why|trade ?off|架构|设计)/i.test(text)) layers.add("key_decisions");
  if (family === "operations" || /(sop|runbook|步骤|流程|排查)/i.test(text)) layers.add("sop");
  if (family === "workspace-defaults" || /(default|preference|偏好|默认)/i.test(text)) layers.add("preferences");
  if (family === "incident" || /(runtime|incident|signal|recent|运行时|近期)/i.test(text)) layers.add("runtime_signals");
  if (!layers.size) layers.add("sources");
  return [...layers];
}

function inferPriority(family: UnifiedSkillFamily): number {
  switch (family) {
    case "operations":
    case "incident":
      return 0.75;
    case "architecture":
      return 0.68;
    case "workspace-defaults":
      return 0.62;
    case "multimodal":
      return 0.55;
    default:
      return 0.5;
  }
}

function parseSkillMetadata(filePath: string): SkillMetadata | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > DEFAULT_MAX_SKILL_FILE_BYTES) return null;
  } catch {
    return null;
  }

  const frontmatter = readFrontmatter(filePath);
  const declaration = validateSkillFrontmatter(frontmatter);
  const skillDir = path.dirname(filePath);
  const declared: Partial<SkillMetadata> = declaration.ok ? declaration.value : {};
  const name = compactWhitespace(String(declared.name ?? frontmatter.name ?? path.basename(skillDir)));
  if (!name) return null;
  const description = compactWhitespace(
    typeof declared.description === "string"
      ? declared.description
      : typeof frontmatter.description === "string"
        ? frontmatter.description
        : readSkillBodyDescription(filePath),
  );
  const tags = declared.tags ?? normalizeArray(frontmatter.tags);
  const family = compactWhitespace(typeof declared.family === "string" ? declared.family : typeof frontmatter.family === "string" ? frontmatter.family : "");
  const familyResolved = (family
    ? family as UnifiedSkillFamily
    : inferFamily(`${name} ${description} ${tags.join(" ")}`));
  const intents = (declared.intents ?? normalizeArray(frontmatter.intents)) as UnifiedRecallIntent[];
  const layers = (declared.layers ?? normalizeArray(frontmatter.layers)) as UnifiedRecallLayer[];
  const priority = declared.priority
    ?? (typeof frontmatter.priority === "string" ? Number(frontmatter.priority) || undefined : undefined)
    ?? inferPriority(familyResolved);

  return {
    name,
    description,
    location: filePath,
    family: familyResolved,
    intents: intents.length ? intents : inferIntents(`${name} ${description} ${tags.join(" ")}`, familyResolved),
    layers: layers.length ? layers : inferLayers(`${name} ${description} ${tags.join(" ")}`, familyResolved),
    tags,
    workspaceScope: declared.workspaceScope ?? normalizeArray(frontmatter.workspaceScope),
    priority,
    disableModelInvocation: declared.disableModelInvocation ?? (compactWhitespace(String(frontmatter.disableModelInvocation ?? "")).toLowerCase() === "true"),
  };
}

function listSkillFiles(rootDir: string): string[] {
  const files: string[] = [];
  try {
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory()) continue;
      const candidate = path.join(rootDir, entry.name, "SKILL.md");
      if (fs.existsSync(candidate)) files.push(candidate);
      if (files.length >= DEFAULT_MAX_SKILLS_PER_ROOT) break;
    }
  } catch {
    return [];
  }
  return files;
}

export function resolveSkillRoots(workspaceDir?: string): string[] {
  return resolveSkillRootsWithExtras({ workspaceDir });
}

export function resolveSkillRootsWithExtras(params: {
  workspaceDir?: string;
  extraRoots?: string[];
}): string[] {
  const roots = new Set<string>();
  const home = os.homedir();
  if (params.workspaceDir?.trim()) {
    roots.add(path.resolve(params.workspaceDir, "skills"));
    roots.add(path.resolve(params.workspaceDir, ".agents", "skills"));
  }
  if (home) {
    roots.add(path.resolve(home, ".agents", "skills"));
    roots.add(path.resolve(home, ".crawclaw", "skills"));
    roots.add(path.resolve(home, ".crawclaw", "workspace", "skills"));
  }
  const cwd = process.cwd();
  if (cwd) {
    roots.add(path.resolve(cwd, "skills"));
    roots.add(path.resolve(cwd, ".agents", "skills"));
  }
  for (const root of params.extraRoots ?? []) {
    if (root.trim()) roots.add(path.resolve(root));
  }
  return [...roots];
}

export function buildSkillIndex(params: {
  workspaceDir?: string;
  extraRoots?: string[];
  logger?: { warn?(message: string): void };
}): SkillIndex {
  const seen = new Map<string, SkillMetadata>();
  for (const root of resolveSkillRootsWithExtras({
    workspaceDir: params.workspaceDir,
    extraRoots: params.extraRoots,
  })) {
    for (const filePath of listSkillFiles(root)) {
      const metadata = parseSkillMetadata(filePath);
      if (!metadata || metadata.disableModelInvocation) continue;
      seen.set(metadata.name, metadata);
    }
  }
  const skills = [...seen.values()].sort((left, right) =>
    (right.priority ?? 0) - (left.priority ?? 0) || left.name.localeCompare(right.name),
  );
  if (!skills.length) {
    params.logger?.warn?.("[memory] skill index is empty; skill routing will stay advisory only");
  }
  return {
    skills,
    byName: new Map(skills.map((skill) => [skill.name, skill])),
    refreshedAt: Date.now(),
  };
}

export function buildSkillIndexFromAvailableSkills(params: {
  availableSkills: Array<{ name: string; description?: string; location: string }>;
  logger?: { warn?(message: string): void };
}): SkillIndex {
  const seen = new Map<string, SkillMetadata>();
  for (const availableSkill of params.availableSkills) {
    const metadata = parseSkillMetadata(availableSkill.location);
    if (metadata && !metadata.disableModelInvocation) {
      seen.set(metadata.name, metadata);
      continue;
    }
    const name = compactWhitespace(availableSkill.name);
    const description = compactWhitespace(availableSkill.description);
    if (!name || !availableSkill.location) continue;
    const tags = normalizeArray("");
    const family = inferFamily(`${name} ${description}`);
    seen.set(name, {
      name,
      description,
      location: availableSkill.location,
      family,
      intents: inferIntents(`${name} ${description}`, family),
      layers: inferLayers(`${name} ${description}`, family),
      tags,
      workspaceScope: [],
      priority: inferPriority(family),
      disableModelInvocation: false,
    });
  }
  const skills = [...seen.values()].sort((left, right) =>
    (right.priority ?? 0) - (left.priority ?? 0) || left.name.localeCompare(right.name),
  );
  if (!skills.length) {
    params.logger?.warn?.("[memory] skill index is empty after reading host availableSkills");
  }
  return {
    skills,
    byName: new Map(skills.map((skill) => [skill.name, skill])),
    refreshedAt: Date.now(),
  };
}
