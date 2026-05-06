import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptPath = fileURLToPath(new URL("./python/qwen3_tts_sidecar.py", import.meta.url));
const pythonScriptPath = fileURLToPath(
  new URL("./python/qwen3_tts_python_sidecar.py", import.meta.url),
);

describe("qwen3_tts_sidecar.py", () => {
  it("starts argument parsing on the host python without importing removed stdlib modules", () => {
    if (!existsSync(scriptPath)) {
      throw new Error(`sidecar script missing: ${scriptPath}`);
    }

    const result = spawnSync("python3", [scriptPath, "--help"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("CrawClaw Qwen3-TTS MLX sidecar");
  });

  it("starts Python sidecar argument parsing without importing model dependencies", () => {
    if (!existsSync(pythonScriptPath)) {
      throw new Error(`sidecar script missing: ${pythonScriptPath}`);
    }

    const result = spawnSync("python3", [pythonScriptPath, "--help"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NO_COLOR: "1",
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("CrawClaw Qwen3-TTS Python sidecar");
  });
});
