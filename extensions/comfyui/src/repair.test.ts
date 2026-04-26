import { describe, expect, it } from "vitest";
import { normalizeNodeCatalog } from "./catalog.js";
import { repairGraphIr } from "./repair.js";
import { imageIrFixture, objectInfoFixture } from "./test-fixtures.js";
import { validateGraphIr } from "./validator.js";

describe("repairGraphIr", () => {
  it("fills safe defaults for missing required literal inputs", () => {
    const catalog = normalizeNodeCatalog(objectInfoFixture);
    const invalid = {
      ...imageIrFixture,
      nodes: imageIrFixture.nodes.map((node) =>
        node.id === "latent" ? { ...node, inputs: { width: 512 } } : node,
      ),
    };
    const diagnostics = validateGraphIr(invalid, catalog).diagnostics;

    const repaired = repairGraphIr({ ir: invalid, catalog, diagnostics });

    expect(validateGraphIr(repaired.ir, catalog).ok).toBe(true);
    expect(repaired.repairs.map((repair) => repair.code)).toContain("filled_default_input");
  });
});
