import type { ComfyGraphIr } from "./graph-ir.js";

export const objectInfoFixture = {
  CheckpointLoaderSimple: {
    input: {
      required: {
        ckpt_name: [["sd15.safetensors", "dream.safetensors"], {}],
      },
    },
    output: ["MODEL", "CLIP", "VAE"],
    output_name: ["MODEL", "CLIP", "VAE"],
    category: "loaders",
  },
  CLIPTextEncode: {
    input: {
      required: {
        text: ["STRING", { default: "" }],
        clip: ["CLIP"],
      },
    },
    output: ["CONDITIONING"],
    category: "conditioning",
  },
  EmptyLatentImage: {
    input: {
      required: {
        width: ["INT", { default: 512 }],
        height: ["INT", { default: 512 }],
        batch_size: ["INT", { default: 1 }],
      },
    },
    output: ["LATENT"],
    category: "latent",
  },
  KSampler: {
    input: {
      required: {
        model: ["MODEL"],
        positive: ["CONDITIONING"],
        negative: ["CONDITIONING"],
        latent_image: ["LATENT"],
        seed: ["INT", { default: 1 }],
        steps: ["INT", { default: 20 }],
        cfg: ["FLOAT", { default: 7 }],
        sampler_name: [["euler", "dpmpp_2m"], {}],
        scheduler: [["normal", "karras"], {}],
        denoise: ["FLOAT", { default: 1 }],
      },
    },
    output: ["LATENT"],
    category: "sampling",
  },
  VAEDecode: {
    input: {
      required: {
        samples: ["LATENT"],
        vae: ["VAE"],
      },
    },
    output: ["IMAGE"],
    category: "latent",
  },
  SaveImage: {
    input: {
      required: {
        images: ["IMAGE"],
        filename_prefix: ["STRING", { default: "ComfyUI" }],
      },
    },
    output: [],
    category: "image",
  },
  VHS_VideoCombine: {
    input: {
      required: {
        images: ["IMAGE"],
        frame_rate: ["INT", { default: 16 }],
        filename_prefix: ["STRING", { default: "ComfyUI" }],
      },
    },
    output: ["VHS_VIDEOINFO"],
    category: "video",
  },
};

export const imageIrFixture: ComfyGraphIr = {
  id: "image-demo",
  goal: "Create a neon crab image",
  mediaKind: "image",
  intent: "text-to-image",
  nodes: [
    {
      id: "loader",
      classType: "CheckpointLoaderSimple",
      purpose: "load checkpoint",
      inputs: { ckpt_name: "sd15.safetensors" },
    },
    {
      id: "positive",
      classType: "CLIPTextEncode",
      purpose: "positive prompt",
      inputs: { text: "neon crab" },
    },
    {
      id: "negative",
      classType: "CLIPTextEncode",
      purpose: "negative prompt",
      inputs: { text: "blurry" },
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
    {
      id: "decode",
      classType: "VAEDecode",
      purpose: "decode image",
      inputs: {},
    },
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

export const videoIrFixture: ComfyGraphIr = {
  ...imageIrFixture,
  id: "video-demo",
  mediaKind: "video",
  intent: "text-to-video",
  nodes: [
    ...imageIrFixture.nodes.filter((node) => node.id !== "save"),
    {
      id: "video",
      classType: "VHS_VideoCombine",
      purpose: "save video",
      inputs: { frame_rate: 16, filename_prefix: "crawclaw-video" },
    },
  ],
  edges: [
    ...imageIrFixture.edges.filter((edge) => edge.to !== "save"),
    { from: "decode", fromOutput: 0, to: "video", toInput: "images" },
  ],
  outputs: [{ nodeId: "video", kind: "video" }],
};
