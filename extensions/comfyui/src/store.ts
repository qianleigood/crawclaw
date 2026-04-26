import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ComfyApiPrompt,
  ComfyGraphDiagnostic,
  ComfyGraphIr,
  ComfyMediaKind,
  ComfyOutputArtifact,
} from "./graph-ir.js";

export type ComfyWorkflowMeta = {
  goal: string;
  baseUrl: string;
  catalogFingerprint: string;
  mediaKind: ComfyMediaKind;
  diagnostics: ComfyGraphDiagnostic[];
  createdAt?: string;
  promptId?: string;
  outputs?: ComfyOutputArtifact[];
};

export type SavedWorkflowArtifacts = {
  workflowId: string;
  irPath: string;
  promptPath: string;
  metaPath: string;
};

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80);
  return slug || "comfyui-workflow";
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function saveWorkflowArtifacts(params: {
  workflowsDir: string;
  ir: ComfyGraphIr;
  prompt: ComfyApiPrompt;
  meta: ComfyWorkflowMeta;
  now?: () => Date;
}): Promise<SavedWorkflowArtifacts> {
  const workflowId = slugify(params.ir.goal);
  const irPath = path.join(params.workflowsDir, `${workflowId}.ir.json`);
  const promptPath = path.join(params.workflowsDir, `${workflowId}.prompt.json`);
  const metaPath = path.join(params.workflowsDir, `${workflowId}.meta.json`);
  await writeJson(irPath, params.ir);
  await writeJson(promptPath, params.prompt);
  await writeJson(metaPath, {
    ...params.meta,
    createdAt: params.meta.createdAt ?? (params.now ?? (() => new Date()))().toISOString(),
  });
  return { workflowId, irPath, promptPath, metaPath };
}

export async function loadWorkflowArtifacts(params: {
  workflowsDir: string;
  workflowId: string;
}): Promise<{ ir: ComfyGraphIr; prompt: ComfyApiPrompt; meta: ComfyWorkflowMeta }> {
  const prefix = path.join(params.workflowsDir, params.workflowId);
  const [ir, prompt, meta] = await Promise.all([
    readFile(`${prefix}.ir.json`, "utf8"),
    readFile(`${prefix}.prompt.json`, "utf8"),
    readFile(`${prefix}.meta.json`, "utf8"),
  ]);
  return {
    ir: JSON.parse(ir) as ComfyGraphIr,
    prompt: JSON.parse(prompt) as ComfyApiPrompt,
    meta: JSON.parse(meta) as ComfyWorkflowMeta,
  };
}
