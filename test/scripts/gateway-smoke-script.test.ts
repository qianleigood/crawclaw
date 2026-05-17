import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy Gateway smoke scripts", () => {
  it("keeps TypeScript dev Gateway smoke helpers removed", async () => {
    const root = process.cwd();

    await expect(fs.stat(path.join(root, "scripts/dev/gateway-smoke.ts"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      fs.stat(path.join(root, "scripts/dev/gateway-ws-client.ts")),
    ).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
