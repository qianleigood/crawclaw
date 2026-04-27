import { describe, expect, it } from "vitest";
import entry from "./index.js";

describe("weixin channel entry", () => {
  it("registers the weixin bundled channel plugin", () => {
    expect(entry).toMatchObject({
      id: "weixin",
      name: "Weixin",
      description: "Weixin channel plugin",
    });
  });
});
