import { describe, expect, it } from "vitest";
import { compileGraphIrToPrompt } from "./compiler.js";
import { imageIrFixture } from "./test-fixtures.js";

describe("compileGraphIrToPrompt", () => {
  it("compiles validated IR into ComfyUI API prompt format", () => {
    const prompt = compileGraphIrToPrompt(imageIrFixture);

    expect(prompt["1"]).toMatchObject({
      class_type: "CheckpointLoaderSimple",
      inputs: { ckpt_name: "sd15.safetensors" },
    });
    expect(prompt["5"]?.inputs).toMatchObject({
      model: ["1", 0],
      positive: ["2", 0],
      negative: ["3", 0],
      latent_image: ["4", 0],
    });
    expect(prompt["7"]).toMatchObject({
      class_type: "SaveImage",
      inputs: { images: ["6", 0], filename_prefix: "crawclaw" },
    });
  });
});
