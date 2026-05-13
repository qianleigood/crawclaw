import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const gatewayDir = path.dirname(fileURLToPath(import.meta.url));

describe("gateway server channel metadata", () => {
  it("does not import the TS channel plugin registry for runtime surface enumeration", () => {
    const source = fs.readFileSync(path.join(gatewayDir, "server.impl.ts"), "utf8");

    expect(source).not.toMatch(/channels\/plugins\/index\.js/);
    expect(source).not.toMatch(/listChannelPlugins/);
  });
});
