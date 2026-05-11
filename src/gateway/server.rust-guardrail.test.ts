import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("TS Gateway server runtime guardrail", () => {
  it("blocks production imports unless explicitly allowed", () => {
    const script = `
      delete process.env.VITEST;
      delete process.env.CRAWCLAW_ALLOW_TS_GATEWAY;
      await import("./src/gateway/server.ts").then(
        () => {
          console.error("unexpected TS Gateway import success");
          process.exit(1);
        },
        (error) => {
          const message = String(error?.message ?? error);
          if (!message.includes("TypeScript Gateway server runtime is disabled")) {
            console.error(message);
            process.exit(1);
          }
        },
      );
    `;

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          CRAWCLAW_ALLOW_TS_GATEWAY: undefined,
          VITEST: undefined,
        },
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
