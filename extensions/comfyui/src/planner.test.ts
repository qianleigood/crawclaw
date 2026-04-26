import { describe, expect, it } from "vitest";
import { normalizeNodeCatalog } from "./catalog.js";
import { createGraphPlan } from "./planner.js";
import { imageIrFixture, objectInfoFixture } from "./test-fixtures.js";

describe("createGraphPlan", () => {
  it("uses a valid candidate IR before built-in graph hints", () => {
    const catalog = normalizeNodeCatalog(objectInfoFixture);

    const result = createGraphPlan({
      goal: "Create image",
      catalog,
      candidateIr: imageIrFixture,
    });

    expect(result.ok).toBe(true);
    expect(result.ir?.id).toBe("image-demo");
  });

  it("creates an image graph from common local ComfyUI nodes", () => {
    const catalog = normalizeNodeCatalog(objectInfoFixture);

    const result = createGraphPlan({
      goal: "Create a neon crab image",
      catalog,
      mediaKind: "image",
    });

    expect(result.ok).toBe(true);
    expect(result.ir?.mediaKind).toBe("image");
    expect(result.ir?.nodes.map((node) => node.classType)).toContain("KSampler");
  });

  it("does not choose video checkpoints for built-in image plans", () => {
    const catalog = normalizeNodeCatalog({
      ...objectInfoFixture,
      CheckpointLoaderSimple: {
        ...objectInfoFixture.CheckpointLoaderSimple,
        input: {
          required: {
            ckpt_name: [["svd_xt_1_1.safetensors", "v1-5-pruned-emaonly-fp16.safetensors"], {}],
          },
        },
      },
    });

    const result = createGraphPlan({
      goal: "Create a tiny image",
      catalog,
      mediaKind: "image",
    });

    expect(result.ok).toBe(true);
    expect(result.ir?.nodes.find((node) => node.id === "loader")?.inputs.ckpt_name).toBe(
      "v1-5-pruned-emaonly-fp16.safetensors",
    );
  });

  it("does not downgrade video requests to image when video nodes are missing", () => {
    const { VHS_VideoCombine: _video, ...imageOnlyObjectInfo } = objectInfoFixture;
    const catalog = normalizeNodeCatalog(imageOnlyObjectInfo);

    const result = createGraphPlan({ goal: "Create a short video", catalog, mediaKind: "video" });

    expect(result.ok).toBe(false);
    expect(result.ir).toBeUndefined();
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_video_output_node",
        }),
      ]),
    );
  });
});
