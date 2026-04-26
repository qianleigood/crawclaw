import { describe, expect, it } from "vitest";
import { normalizeNodeCatalog } from "./catalog.js";
import { objectInfoFixture } from "./test-fixtures.js";

describe("normalizeNodeCatalog", () => {
  it("normalizes object_info and produces a stable fingerprint", () => {
    const first = normalizeNodeCatalog(objectInfoFixture);
    const second = normalizeNodeCatalog({ ...objectInfoFixture });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.getNode("KSampler")?.requiredInputs.map((input) => input.name)).toContain("model");
    expect(
      first.getNode("KSampler")?.requiredInputs.find((input) => input.name === "sampler_name"),
    ).toMatchObject({ choices: ["euler", "dpmpp_2m"] });
  });

  it("discovers video output nodes from local catalog signals", () => {
    const catalog = normalizeNodeCatalog(objectInfoFixture);

    expect(catalog.findVideoOutputNodes().map((node) => node.classType)).toContain(
      "VHS_VideoCombine",
    );
  });
});
