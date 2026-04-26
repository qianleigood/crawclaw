import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectOutputArtifacts, downloadOutputArtifacts } from "./outputs.js";

const tempDirs: string[] = [];

async function createTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "crawclaw-comfyui-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("collectOutputArtifacts", () => {
  it("extracts image, video, audio, and unknown file outputs from history", () => {
    const artifacts = collectOutputArtifacts("prompt-1", {
      "prompt-1": {
        outputs: {
          "7": {
            images: [{ filename: "a.png", subfolder: "", type: "output" }],
            videos: [{ filename: "b.mp4", subfolder: "video", type: "output" }],
            audio: [{ filename: "c.wav", subfolder: "", type: "output" }],
            previews: [{ filename: "d.dat", subfolder: "", type: "temp" }],
          },
        },
      },
    });

    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      "image",
      "video",
      "audio",
      "unknown",
    ]);
  });

  it("classifies animated image outputs as video artifacts", () => {
    const artifacts = collectOutputArtifacts("prompt-1", {
      "prompt-1": {
        outputs: {
          "7": {
            images: [{ filename: "animation.webp", subfolder: "", type: "output" }],
            animated: [true],
          },
        },
      },
    });

    expect(artifacts).toEqual([
      expect.objectContaining({
        kind: "video",
        filename: "animation.webp",
      }),
    ]);
  });
});

describe("downloadOutputArtifacts", () => {
  it("writes downloads under the prompt output directory and blocks path traversal", async () => {
    const outputDir = await createTempDir();
    const client = {
      downloadView: vi.fn(async () => new Uint8Array(Buffer.from("image-bytes"))),
    };

    const [artifact] = await downloadOutputArtifacts({
      client,
      outputDir,
      promptId: "prompt-1",
      artifacts: [{ kind: "image", nodeId: "7", filename: "../a.png", type: "output" }],
    });

    expect(artifact?.localPath).toBe(path.join(outputDir, "prompt-1", "a.png"));
    await expect(readFile(artifact?.localPath ?? "", "utf8")).resolves.toBe("image-bytes");
  });
});
