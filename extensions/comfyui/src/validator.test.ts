import { describe, expect, it } from "vitest";
import { normalizeNodeCatalog } from "./catalog.js";
import { imageIrFixture, objectInfoFixture, videoIrFixture } from "./test-fixtures.js";
import { validateGraphIr } from "./validator.js";

describe("validateGraphIr", () => {
  it("accepts a valid image workflow graph", () => {
    const catalog = normalizeNodeCatalog(objectInfoFixture);

    const result = validateGraphIr(imageIrFixture, catalog);

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a video workflow when video output nodes exist", () => {
    const catalog = normalizeNodeCatalog(objectInfoFixture);

    const result = validateGraphIr(videoIrFixture, catalog);

    expect(result.ok).toBe(true);
  });

  it("blocks video workflows when the local catalog has no video output path", () => {
    const { VHS_VideoCombine: _video, ...imageOnlyObjectInfo } = objectInfoFixture;
    const catalog = normalizeNodeCatalog(imageOnlyObjectInfo);

    const result = validateGraphIr(videoIrFixture, catalog);

    expect(result.ok).toBe(false);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_video_output_node",
          severity: "error",
        }),
      ]),
    );
  });

  it("reports missing required inputs and invalid enum choices", () => {
    const catalog = normalizeNodeCatalog(objectInfoFixture);
    const invalid = {
      ...imageIrFixture,
      nodes: imageIrFixture.nodes.map((node) =>
        node.id === "sampler"
          ? { ...node, inputs: { ...node.inputs, sampler_name: "not-a-sampler" } }
          : node.id === "latent"
            ? { ...node, inputs: { width: 512 } }
            : node,
      ),
    };

    const result = validateGraphIr(invalid, catalog);

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diag) => diag.code)).toEqual(
      expect.arrayContaining(["invalid_choice", "missing_required_input"]),
    );
  });
});
