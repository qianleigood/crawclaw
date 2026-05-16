import { describe, expect, it } from "vitest";

describe("createDefaultDeps", () => {
  it("does not expose channel sender dependencies", async () => {
    const { createDefaultDeps } = await import("./deps.js");

    expect(createDefaultDeps()).toEqual({});
  });
});
