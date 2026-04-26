import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPathInside } from "./config.js";
import type { ComfyOutputArtifact } from "./graph-ir.js";
import { isRecord } from "./graph-ir.js";

type DownloadClient = {
  downloadView(params: {
    filename: string;
    subfolder?: string;
    type?: string;
  }): Promise<Uint8Array>;
};

function fileKind(key: string, filename: string): ComfyOutputArtifact["kind"] {
  const normalized = `${key} ${filename}`.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)$/.test(normalized) || normalized.includes("image")) {
    return "image";
  }
  if (/\.(mp4|webm|mov|mkv)$/.test(normalized) || normalized.includes("video")) {
    return "video";
  }
  if (/\.(wav|mp3|flac|ogg)$/.test(normalized) || normalized.includes("audio")) {
    return "audio";
  }
  return "unknown";
}

function safeFilename(filename: string): string {
  const base = path.basename(filename);
  return base || "output.bin";
}

function historyEntry(promptId: string, history: unknown): unknown {
  if (!isRecord(history)) {
    return {};
  }
  return history[promptId] ?? history;
}

export function collectOutputArtifacts(promptId: string, history: unknown): ComfyOutputArtifact[] {
  const entry = historyEntry(promptId, history);
  const outputs = isRecord(entry) && isRecord(entry.outputs) ? entry.outputs : {};
  const artifacts: ComfyOutputArtifact[] = [];
  for (const [nodeId, nodeOutput] of Object.entries(outputs)) {
    if (!isRecord(nodeOutput)) {
      continue;
    }
    const animated =
      Array.isArray(nodeOutput.animated) && nodeOutput.animated.some((value) => value === true);
    for (const [key, value] of Object.entries(nodeOutput)) {
      if (!Array.isArray(value)) {
        continue;
      }
      for (const item of value) {
        if (!isRecord(item) || typeof item.filename !== "string") {
          continue;
        }
        artifacts.push({
          kind: animated && key === "images" ? "video" : fileKind(key, item.filename),
          nodeId,
          filename: item.filename,
          subfolder: typeof item.subfolder === "string" ? item.subfolder : undefined,
          type: typeof item.type === "string" ? item.type : undefined,
        });
      }
    }
  }
  return artifacts;
}

export async function downloadOutputArtifacts(params: {
  client: DownloadClient;
  outputDir: string;
  promptId: string;
  artifacts: ComfyOutputArtifact[];
}): Promise<ComfyOutputArtifact[]> {
  const promptDir = path.join(params.outputDir, params.promptId);
  assertPathInside(params.outputDir, promptDir);
  await mkdir(promptDir, { recursive: true });
  const downloaded: ComfyOutputArtifact[] = [];
  for (const artifact of params.artifacts) {
    const filename = safeFilename(artifact.filename);
    const localPath = path.join(promptDir, filename);
    assertPathInside(promptDir, localPath);
    const bytes = await params.client.downloadView({
      filename: artifact.filename,
      subfolder: artifact.subfolder,
      type: artifact.type,
    });
    await writeFile(localPath, bytes);
    downloaded.push({ ...artifact, filename, localPath });
  }
  return downloaded;
}
