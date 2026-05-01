import type { Skill } from "@mariozechner/pi-coding-agent";
import { validateRegistryNpmSpec } from "../../infra/npm-registry-spec.js";
import { parseFrontmatterBlock } from "../../markdown/frontmatter.js";
import {
  applyCrawClawManifestInstallCommonFields,
  getFrontmatterString,
  normalizeStringList,
  parseCrawClawManifestInstallBase,
  parseFrontmatterBool,
  resolveCrawClawManifestArch,
  resolveCrawClawManifestBlock,
  resolveCrawClawManifestInstall,
  resolveCrawClawManifestOs,
  resolveCrawClawManifestRequires,
} from "../../shared/frontmatter.js";
import type {
  WorkflowHttpMethod,
  WorkflowPortability,
  WorkflowStepKind,
} from "../../workflows/api.js";
import type {
  CrawClawSkillMetadata,
  ParsedSkillFrontmatter,
  SkillEntry,
  SkillInstallSpec,
  SkillInvocationPolicy,
} from "./types.js";

const WORKFLOW_PORTABILITY_VALUES = new Set<string>([
  "native",
  "service",
  "crawclaw_agent",
  "human",
  "non_portable",
]);

const WORKFLOW_STEP_KIND_VALUES = new Set<string>([
  "native",
  "service",
  "crawclaw_agent",
  "human_wait",
]);

const WORKFLOW_HTTP_METHOD_VALUES = new Set<string>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export function parseFrontmatter(content: string): ParsedSkillFrontmatter {
  return parseFrontmatterBlock(content);
}

const BREW_FORMULA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9@+._/-]*$/;
const GO_MODULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~+\-/]*(?:@[A-Za-z0-9][A-Za-z0-9._~+\-/]*)?$/;
const UV_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=<>!~+,]*$/;

function normalizeSafeBrewFormula(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const formula = raw.trim();
  if (!formula || formula.startsWith("-") || formula.includes("\\") || formula.includes("..")) {
    return undefined;
  }
  if (!BREW_FORMULA_PATTERN.test(formula)) {
    return undefined;
  }
  return formula;
}

function normalizeSafeNpmSpec(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const spec = raw.trim();
  if (!spec || spec.startsWith("-")) {
    return undefined;
  }
  if (validateRegistryNpmSpec(spec) !== null) {
    return undefined;
  }
  return spec;
}

function normalizeSafeGoModule(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const moduleSpec = raw.trim();
  if (
    !moduleSpec ||
    moduleSpec.startsWith("-") ||
    moduleSpec.includes("\\") ||
    moduleSpec.includes("://")
  ) {
    return undefined;
  }
  if (!GO_MODULE_PATTERN.test(moduleSpec)) {
    return undefined;
  }
  return moduleSpec;
}

function normalizeSafeUvPackage(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const pkg = raw.trim();
  if (!pkg || pkg.startsWith("-") || pkg.includes("\\") || pkg.includes("://")) {
    return undefined;
  }
  if (!UV_PACKAGE_PATTERN.test(pkg)) {
    return undefined;
  }
  return pkg;
}

function normalizeSafeDownloadUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const value = raw.trim();
  if (!value || /\s/.test(value)) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseInstallSpec(input: unknown): SkillInstallSpec | undefined {
  const parsed = parseCrawClawManifestInstallBase(input, ["brew", "node", "go", "uv", "download"]);
  if (!parsed) {
    return undefined;
  }
  const { raw } = parsed;
  const spec = applyCrawClawManifestInstallCommonFields<SkillInstallSpec>(
    {
      kind: parsed.kind as SkillInstallSpec["kind"],
    },
    parsed,
  );
  const osList = normalizeStringList(raw.os);
  if (osList.length > 0) {
    spec.os = osList;
  }
  const formula = normalizeSafeBrewFormula(raw.formula);
  if (formula) {
    spec.formula = formula;
  }
  const cask = normalizeSafeBrewFormula(raw.cask);
  if (!spec.formula && cask) {
    spec.formula = cask;
  }
  if (spec.kind === "node") {
    const pkg = normalizeSafeNpmSpec(raw.package);
    if (pkg) {
      spec.package = pkg;
    }
  } else if (spec.kind === "uv") {
    const pkg = normalizeSafeUvPackage(raw.package);
    if (pkg) {
      spec.package = pkg;
    }
  }
  const moduleSpec = normalizeSafeGoModule(raw.module);
  if (moduleSpec) {
    spec.module = moduleSpec;
  }
  const downloadUrl = normalizeSafeDownloadUrl(raw.url);
  if (downloadUrl) {
    spec.url = downloadUrl;
  }
  if (typeof raw.archive === "string") {
    spec.archive = raw.archive;
  }
  if (typeof raw.extract === "boolean") {
    spec.extract = raw.extract;
  }
  if (typeof raw.stripComponents === "number") {
    spec.stripComponents = raw.stripComponents;
  }
  if (typeof raw.targetDir === "string") {
    spec.targetDir = raw.targetDir;
  }

  if (spec.kind === "brew" && !spec.formula) {
    return undefined;
  }
  if (spec.kind === "node" && !spec.package) {
    return undefined;
  }
  if (spec.kind === "go" && !spec.module) {
    return undefined;
  }
  if (spec.kind === "uv" && !spec.package) {
    return undefined;
  }
  if (spec.kind === "download" && !spec.url) {
    return undefined;
  }

  return spec;
}

export function resolveCrawClawMetadata(
  frontmatter: ParsedSkillFrontmatter,
): CrawClawSkillMetadata | undefined {
  const metadataObj = resolveCrawClawManifestBlock({ frontmatter });
  if (!metadataObj) {
    return undefined;
  }
  const requires = resolveCrawClawManifestRequires(metadataObj);
  const install = resolveCrawClawManifestInstall(metadataObj, parseInstallSpec);
  const osRaw = resolveCrawClawManifestOs(metadataObj);
  const archRaw = resolveCrawClawManifestArch(metadataObj);
  const workflowRaw =
    typeof metadataObj.workflow === "object" && metadataObj.workflow !== null
      ? (metadataObj.workflow as Record<string, unknown>)
      : undefined;
  const workflowPortability: WorkflowPortability | undefined =
    typeof workflowRaw?.portability === "string" &&
    WORKFLOW_PORTABILITY_VALUES.has(workflowRaw.portability.trim())
      ? (workflowRaw.portability.trim() as WorkflowPortability)
      : undefined;
  const workflowStepKind: WorkflowStepKind | undefined =
    typeof workflowRaw?.stepKind === "string" &&
    WORKFLOW_STEP_KIND_VALUES.has(workflowRaw.stepKind.trim())
      ? (workflowRaw.stepKind.trim() as WorkflowStepKind)
      : undefined;
  const workflowServiceMethod: WorkflowHttpMethod | undefined =
    typeof workflowRaw?.serviceMethod === "string" &&
    WORKFLOW_HTTP_METHOD_VALUES.has(workflowRaw.serviceMethod.trim().toUpperCase())
      ? (workflowRaw.serviceMethod.trim().toUpperCase() as WorkflowHttpMethod)
      : undefined;
  const workflowServiceUrl = normalizeSafeDownloadUrl(workflowRaw?.serviceUrl);
  const workflowTags = normalizeStringList(workflowRaw?.tags);
  const workflowAllowedTools = normalizeStringList(workflowRaw?.allowedTools);
  const workflowAllowedSkills = normalizeStringList(workflowRaw?.allowedSkills);
  const workflowWaitKind: "input" | "external" | undefined =
    workflowRaw?.waitKind === "input" || workflowRaw?.waitKind === "external"
      ? workflowRaw.waitKind
      : undefined;
  const workflowNotes =
    typeof workflowRaw?.notes === "string" && workflowRaw.notes.trim()
      ? workflowRaw.notes.trim()
      : undefined;
  const workflowRequiresApproval =
    typeof workflowRaw?.requiresApproval === "boolean" ? workflowRaw.requiresApproval : undefined;
  const workflow =
    workflowRaw &&
    (workflowPortability ||
      workflowStepKind ||
      workflowServiceUrl ||
      workflowServiceMethod ||
      workflowTags.length > 0 ||
      workflowAllowedTools.length > 0 ||
      workflowAllowedSkills.length > 0 ||
      workflowWaitKind ||
      workflowNotes ||
      workflowRequiresApproval !== undefined)
      ? {
          ...(workflowPortability ? { portability: workflowPortability } : {}),
          ...(workflowStepKind ? { stepKind: workflowStepKind } : {}),
          ...(workflowServiceUrl ? { serviceUrl: workflowServiceUrl } : {}),
          ...(workflowServiceMethod ? { serviceMethod: workflowServiceMethod } : {}),
          ...(workflowTags.length > 0 ? { tags: workflowTags } : {}),
          ...(workflowAllowedTools.length > 0 ? { allowedTools: workflowAllowedTools } : {}),
          ...(workflowAllowedSkills.length > 0 ? { allowedSkills: workflowAllowedSkills } : {}),
          ...(workflowRequiresApproval !== undefined
            ? { requiresApproval: workflowRequiresApproval }
            : {}),
          ...(workflowWaitKind ? { waitKind: workflowWaitKind } : {}),
          ...(workflowNotes ? { notes: workflowNotes } : {}),
        }
      : undefined;
  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: typeof metadataObj.emoji === "string" ? metadataObj.emoji : undefined,
    homepage: typeof metadataObj.homepage === "string" ? metadataObj.homepage : undefined,
    skillKey: typeof metadataObj.skillKey === "string" ? metadataObj.skillKey : undefined,
    primaryEnv: typeof metadataObj.primaryEnv === "string" ? metadataObj.primaryEnv : undefined,
    os: osRaw.length > 0 ? osRaw : undefined,
    arch: archRaw.length > 0 ? archRaw : undefined,
    requires: requires,
    install: install.length > 0 ? install : undefined,
    workflow,
  };
}

export function resolveSkillInvocationPolicy(
  frontmatter: ParsedSkillFrontmatter,
): SkillInvocationPolicy {
  return {
    userInvocable: parseFrontmatterBool(getFrontmatterString(frontmatter, "user-invocable"), true),
    disableModelInvocation: parseFrontmatterBool(
      getFrontmatterString(frontmatter, "disable-model-invocation"),
      false,
    ),
  };
}

export function resolveSkillKey(skill: Skill, entry?: SkillEntry): string {
  return entry?.metadata?.skillKey ?? skill.name;
}
