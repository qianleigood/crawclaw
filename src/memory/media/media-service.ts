import { createHash } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { newId } from "../util/ids.ts";
import { resolveHome } from "../util/path.ts";
import type { MediaAsset, MessageBlock, MessageMediaRef } from "../types/media.ts";

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") {return "png";}
  if (mimeType === "image/jpeg") {return "jpg";}
  if (mimeType === "image/webp") {return "webp";}
  if (mimeType === "image/svg+xml") {return "svg";}
  if (mimeType === "application/pdf") {return "pdf";}
  return "bin";
}

function parseDataUri(value: string): { mimeType: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/i.exec(value);
  if (!match) {return null;}
  const mimeType = match[1] || "application/octet-stream";
  const payload = match[2] || "";
  try {
    const buffer = value.includes(";base64,")
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
    return { mimeType, buffer };
  } catch {
    return null;
  }
}

export interface MediaIngestResult {
  blocks: MessageBlock[];
  mediaAssets: MediaAsset[];
  mediaRefs: MessageMediaRef[];
  primaryMediaId: string | null;
  hasMedia: boolean;
}

export interface MediaServiceOptions {
  cacheRoot?: string;
  maxAssetBytes?: number;
}

export class MediaService {
  private readonly cacheRoot: string;
  private readonly maxAssetBytes: number;

  constructor(options: MediaServiceOptions = {}) {
    this.cacheRoot = resolveHome(options.cacheRoot ?? "~/.crawclaw/memory-media");
    this.maxAssetBytes = options.maxAssetBytes ?? 20 * 1024 * 1024;
  }

  async ingestBlocks(blocks: MessageBlock[]): Promise<MediaIngestResult> {
    await mkdir(this.cacheRoot, { recursive: true });
    const mediaAssets: MediaAsset[] = [];
    const mediaRefs: MessageMediaRef[] = [];
    const normalizedBlocks: MessageBlock[] = [];

    for (const block of blocks) {
      if (block.type === "text" || block.type === "link") {
        normalizedBlocks.push(block);
        continue;
      }

      const mediaId = block.mediaId ?? newId("media");
      const asset = await this.materializeAsset(mediaId, block);
      mediaAssets.push(asset);
      mediaRefs.push({
        mediaId,
        ordinal: mediaRefs.length,
        role: mediaRefs.length === 0 ? "primary" : "supporting",
      });
      normalizedBlocks.push({ ...block, mediaId });
    }

    return {
      blocks: normalizedBlocks,
      mediaAssets,
      mediaRefs,
      primaryMediaId: mediaRefs[0]?.mediaId ?? null,
      hasMedia: mediaRefs.length > 0,
    };
  }

  private async materializeAsset(mediaId: string, block: Extract<MessageBlock, { type: "image" | "file" }>): Promise<MediaAsset> {
    const now = Date.now();

    if (block.type === "image" && block.url.startsWith("data:")) {
      const parsed = parseDataUri(block.url);
      if (!parsed) {
        return {
          mediaId,
          kind: "image",
          sourceType: "message_block",
          originalUrl: block.url,
          mimeType: null,
          alt: block.alt ?? null,
          caption: block.caption ?? null,
          status: "failed",
          createdAt: now,
          updatedAt: now,
        };
      }
      if (parsed.buffer.byteLength > this.maxAssetBytes) {
        return {
          mediaId,
          kind: "image",
          sourceType: "message_block",
          originalUrl: block.url,
          mimeType: parsed.mimeType,
          alt: block.alt ?? null,
          caption: block.caption ?? null,
          sizeBytes: parsed.buffer.byteLength,
          status: "failed",
          createdAt: now,
          updatedAt: now,
        };
      }
      const sha256 = createHash("sha256").update(parsed.buffer).digest("hex");
      const ext = extensionForMime(parsed.mimeType);
      const localPath = path.join(this.cacheRoot, `${sha256}.${ext}`);
      await this.writeIfMissing(localPath, parsed.buffer);
      return {
        mediaId,
        kind: "image",
        sourceType: "message_block",
        originalUrl: block.url,
        localPath,
        mimeType: parsed.mimeType,
        fileName: path.basename(localPath),
        sha256,
        sizeBytes: parsed.buffer.byteLength,
        alt: block.alt ?? null,
        caption: block.caption ?? null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
    }

    if (block.type === "file") {
      const localPath = resolveHome(block.path);
      try {
        const meta = await stat(localPath);
        if (meta.size > this.maxAssetBytes) {
          return {
            mediaId,
            kind: "file",
            sourceType: "attachment",
            localPath,
            fileName: block.name ?? path.basename(localPath),
            mimeType: block.mimeType ?? null,
            sizeBytes: meta.size,
            caption: block.title ?? null,
            status: "failed",
            createdAt: now,
            updatedAt: now,
          };
        }
        const buffer = await readFile(localPath);
        const sha256 = createHash("sha256").update(buffer).digest("hex");
        return {
          mediaId,
          kind: "file",
          sourceType: "attachment",
          localPath,
          fileName: block.name ?? path.basename(localPath),
          mimeType: block.mimeType ?? null,
          sha256,
          sizeBytes: meta.size,
          caption: block.title ?? null,
          status: "active",
          createdAt: now,
          updatedAt: now,
        };
      } catch {
        return {
          mediaId,
          kind: "file",
          sourceType: "attachment",
          localPath,
          fileName: block.name ?? path.basename(localPath),
          mimeType: block.mimeType ?? null,
          caption: block.title ?? null,
          status: "missing",
          createdAt: now,
          updatedAt: now,
        };
      }
    }

    return await this.materializeRemoteImage(mediaId, block, now);
  }

  private async materializeRemoteImage(
    mediaId: string,
    block: Extract<MessageBlock, { type: "image" }>,
    now: number,
  ): Promise<MediaAsset> {
    try {
      const res = await fetch(block.url);
      if (!res.ok) {
        return {
          mediaId,
          kind: "image",
          sourceType: "message_block",
          originalUrl: block.url,
          mimeType: block.mimeType ?? null,
          alt: block.alt ?? null,
          caption: block.caption ?? null,
          status: "failed",
          createdAt: now,
          updatedAt: now,
        };
      }
      const contentLength = Number(res.headers.get("content-length") || "0");
      if (Number.isFinite(contentLength) && contentLength > this.maxAssetBytes) {
        return {
          mediaId,
          kind: "image",
          sourceType: "message_block",
          originalUrl: block.url,
          mimeType: res.headers.get("content-type") || block.mimeType || null,
          alt: block.alt ?? null,
          caption: block.caption ?? null,
          sizeBytes: contentLength,
          status: "failed",
          createdAt: now,
          updatedAt: now,
        };
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > this.maxAssetBytes) {
        return {
          mediaId,
          kind: "image",
          sourceType: "message_block",
          originalUrl: block.url,
          mimeType: res.headers.get("content-type") || block.mimeType || null,
          alt: block.alt ?? null,
          caption: block.caption ?? null,
          sizeBytes: buffer.byteLength,
          status: "failed",
          createdAt: now,
          updatedAt: now,
        };
      }
      const mimeType = res.headers.get("content-type") || block.mimeType || "application/octet-stream";
      const sha256 = createHash("sha256").update(buffer).digest("hex");
      const ext = extensionForMime(mimeType);
      const localPath = path.join(this.cacheRoot, `${sha256}.${ext}`);
      await this.writeIfMissing(localPath, buffer);
      return {
        mediaId,
        kind: "image",
        sourceType: "message_block",
        originalUrl: block.url,
        localPath,
        mimeType,
        fileName: path.basename(localPath),
        sha256,
        sizeBytes: buffer.byteLength,
        alt: block.alt ?? null,
        caption: block.caption ?? null,
        status: "active",
        createdAt: now,
        updatedAt: now,
      };
    } catch {
      return {
        mediaId,
        kind: "image",
        sourceType: "message_block",
        originalUrl: block.url,
        mimeType: block.mimeType ?? null,
        alt: block.alt ?? null,
        caption: block.caption ?? null,
        fileName: (() => {
          try {
            return path.basename(new URL(block.url).pathname) || null;
          } catch {
            return null;
          }
        })(),
        status: "failed",
        createdAt: now,
        updatedAt: now,
      };
    }
  }

  private async writeIfMissing(filePath: string, buffer: Buffer): Promise<void> {
    try {
      await access(filePath);
      return;
    } catch {
      await writeFile(filePath, buffer);
    }
  }
}
