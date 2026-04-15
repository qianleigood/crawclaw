import fs from "node:fs/promises";
import path from "node:path";
import type { PluginSdkDocCategory, PluginSdkDocEntrypoint } from "../../scripts/lib/plugin-sdk-doc-metadata.ts";
import {
  loadCurrentFile,
  renderPluginSdkApiBaselineData,
  resolveRepoRoot,
} from "./api-baseline-helpers.js";

export type PluginSdkApiExportKind =
  | "class"
  | "const"
  | "enum"
  | "function"
  | "interface"
  | "namespace"
  | "type"
  | "unknown"
  | "variable";

export type PluginSdkApiSourceLink = {
  line: number;
  path: string;
};

export type PluginSdkApiExport = {
  declaration: string | null;
  exportName: string;
  kind: PluginSdkApiExportKind;
  source: PluginSdkApiSourceLink | null;
};

export type PluginSdkApiModule = {
  category: PluginSdkDocCategory;
  entrypoint: PluginSdkDocEntrypoint;
  exports: PluginSdkApiExport[];
  importSpecifier: string;
  source: PluginSdkApiSourceLink;
};

export type PluginSdkApiBaseline = {
  generatedBy: "scripts/generate-plugin-sdk-api-baseline.ts";
  modules: PluginSdkApiModule[];
};

export type PluginSdkApiBaselineRender = {
  baseline: PluginSdkApiBaseline;
  json: string;
  jsonl: string;
};

export type PluginSdkApiBaselineWriteResult = {
  changed: boolean;
  wrote: boolean;
  jsonPath: string;
  statefilePath: string;
};

const GENERATED_BY = "scripts/generate-plugin-sdk-api-baseline.ts" as const;
const DEFAULT_JSON_OUTPUT = "docs/.generated/plugin-sdk-api-baseline.json";
const DEFAULT_STATEFILE_OUTPUT = "docs/.generated/plugin-sdk-api-baseline.jsonl";
export async function renderPluginSdkApiBaseline(params?: {
  repoRoot?: string;
}): Promise<PluginSdkApiBaselineRender> {
  const repoRoot = params?.repoRoot ?? resolveRepoRoot();
  return renderPluginSdkApiBaselineData({
    repoRoot,
    generatedBy: GENERATED_BY,
  });
}

export async function writePluginSdkApiBaselineStatefile(params?: {
  repoRoot?: string;
  check?: boolean;
  jsonPath?: string;
  statefilePath?: string;
}): Promise<PluginSdkApiBaselineWriteResult> {
  const repoRoot = params?.repoRoot ?? resolveRepoRoot();
  const jsonPath = path.resolve(repoRoot, params?.jsonPath ?? DEFAULT_JSON_OUTPUT);
  const statefilePath = path.resolve(repoRoot, params?.statefilePath ?? DEFAULT_STATEFILE_OUTPUT);
  const rendered = await renderPluginSdkApiBaseline({ repoRoot });
  const currentJson = await loadCurrentFile(jsonPath);
  const currentJsonl = await loadCurrentFile(statefilePath);
  const changed = currentJson !== rendered.json || currentJsonl !== rendered.jsonl;

  if (params?.check) {
    return {
      changed,
      wrote: false,
      jsonPath,
      statefilePath,
    };
  }

  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, rendered.json, "utf8");
  await fs.writeFile(statefilePath, rendered.jsonl, "utf8");

  return {
    changed,
    wrote: true,
    jsonPath,
    statefilePath,
  };
}
