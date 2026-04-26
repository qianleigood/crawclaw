import type { ComfyNodeCatalog } from "./catalog.js";
import type {
  ComfyGraphDiagnostic,
  ComfyGraphIr,
  ComfyIntent,
  ComfyMediaKind,
} from "./graph-ir.js";
import { parseGraphIr } from "./graph-ir.js";
import { validateGraphIr } from "./validator.js";

export type CreateGraphPlanParams = {
  goal: string;
  catalog: ComfyNodeCatalog;
  mediaKind?: ComfyMediaKind | "auto";
  intent?: ComfyIntent;
  candidateIr?: unknown;
};

export type CreateGraphPlanResult =
  | { ok: true; ir: ComfyGraphIr; diagnostics: ComfyGraphDiagnostic[] }
  | { ok: false; diagnostics: ComfyGraphDiagnostic[]; ir?: undefined };

function inferMediaKind(goal: string, mediaKind?: ComfyMediaKind | "auto"): ComfyMediaKind {
  if (mediaKind && mediaKind !== "auto") {
    return mediaKind;
  }
  return /video|movie|clip|frames|animation|动画|视频/i.test(goal) ? "video" : "image";
}

function requireClass(catalog: ComfyNodeCatalog, classType: string): boolean {
  return !!catalog.getNode(classType);
}

function hasCommonImagePath(catalog: ComfyNodeCatalog): boolean {
  return [
    "CheckpointLoaderSimple",
    "CLIPTextEncode",
    "EmptyLatentImage",
    "KSampler",
    "VAEDecode",
    "SaveImage",
  ].every((classType) => requireClass(catalog, classType));
}

function firstChoice(
  catalog: ComfyNodeCatalog,
  classType: string,
  field: string,
  fallback: string,
): string {
  const node = catalog.getNode(classType);
  const input = [...(node?.requiredInputs ?? []), ...(node?.optionalInputs ?? [])].find(
    (entry) => entry.name === field,
  );
  return input?.choices?.[0] ?? fallback;
}

function imageGraph(goal: string, catalog: ComfyNodeCatalog): ComfyGraphIr {
  return {
    id: "draft",
    goal,
    mediaKind: "image",
    intent: "text-to-image",
    nodes: [
      {
        id: "loader",
        classType: "CheckpointLoaderSimple",
        purpose: "load checkpoint",
        inputs: {
          ckpt_name: firstChoice(
            catalog,
            "CheckpointLoaderSimple",
            "ckpt_name",
            "model.safetensors",
          ),
        },
      },
      {
        id: "positive",
        classType: "CLIPTextEncode",
        purpose: "positive prompt",
        inputs: { text: goal },
      },
      {
        id: "negative",
        classType: "CLIPTextEncode",
        purpose: "negative prompt",
        inputs: { text: "" },
      },
      {
        id: "latent",
        classType: "EmptyLatentImage",
        purpose: "latent image",
        inputs: { width: 512, height: 512, batch_size: 1 },
      },
      {
        id: "sampler",
        classType: "KSampler",
        purpose: "sample image",
        inputs: {
          seed: 1,
          steps: 20,
          cfg: 7,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1,
        },
      },
      { id: "decode", classType: "VAEDecode", purpose: "decode image", inputs: {} },
      {
        id: "save",
        classType: "SaveImage",
        purpose: "save image",
        inputs: { filename_prefix: "crawclaw" },
      },
    ],
    edges: [
      { from: "loader", fromOutput: 1, to: "positive", toInput: "clip" },
      { from: "loader", fromOutput: 1, to: "negative", toInput: "clip" },
      { from: "loader", fromOutput: 0, to: "sampler", toInput: "model" },
      { from: "positive", fromOutput: 0, to: "sampler", toInput: "positive" },
      { from: "negative", fromOutput: 0, to: "sampler", toInput: "negative" },
      { from: "latent", fromOutput: 0, to: "sampler", toInput: "latent_image" },
      { from: "sampler", fromOutput: 0, to: "decode", toInput: "samples" },
      { from: "loader", fromOutput: 2, to: "decode", toInput: "vae" },
      { from: "decode", fromOutput: 0, to: "save", toInput: "images" },
    ],
    outputs: [{ nodeId: "save", kind: "image" }],
  };
}

function planBuiltIn(
  params: CreateGraphPlanParams,
  mediaKind: ComfyMediaKind,
): CreateGraphPlanResult {
  if (mediaKind === "video") {
    if (catalogHasNoVideo(params.catalog)) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "missing_video_output_node",
            severity: "error",
            message: "The local ComfyUI catalog does not expose a video output/combine node.",
          },
        ],
      };
    }
    return {
      ok: false,
      diagnostics: [
        {
          code: "planner_unavailable",
          severity: "error",
          message: "Video planning needs a candidate IR for this local node set.",
        },
      ],
    };
  }
  if (!hasCommonImagePath(params.catalog)) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "planner_unavailable",
          severity: "error",
          message: "The local ComfyUI catalog is missing common image generation nodes.",
        },
      ],
    };
  }
  const ir = imageGraph(params.goal, params.catalog);
  const validation = validateGraphIr(ir, params.catalog);
  return validation.ok
    ? { ok: true, ir, diagnostics: validation.diagnostics }
    : { ok: false, diagnostics: validation.diagnostics };
}

function catalogHasNoVideo(catalog: ComfyNodeCatalog): boolean {
  return catalog.findVideoOutputNodes().length === 0;
}

export function createGraphPlan(params: CreateGraphPlanParams): CreateGraphPlanResult {
  const candidate = parseGraphIr(params.candidateIr);
  if (candidate) {
    const validation = validateGraphIr(candidate, params.catalog);
    if (validation.ok) {
      return { ok: true, ir: candidate, diagnostics: validation.diagnostics };
    }
    return { ok: false, diagnostics: validation.diagnostics };
  }
  return planBuiltIn(params, inferMediaKind(params.goal, params.mediaKind));
}
