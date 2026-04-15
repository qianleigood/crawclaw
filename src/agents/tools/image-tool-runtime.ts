import { dirname, isAbsolute, resolve } from "node:path";
import { loadWebMedia } from "../../media/web-media.js";
import { resolveUserPath } from "../../utils.js";
import { decodeDataUrl } from "./image-tool.helpers.js";
import { resolveMediaToolLocalRoots, resolvePromptAndModelOverride } from "./media-tool-shared.js";
import {
  createSandboxBridgeReadFile,
  resolveSandboxedBridgeMediaPath,
  type SandboxedBridgeMediaPathConfig,
  type SandboxFsBridge,
  type ToolFsPolicy,
} from "./tool-runtime.helpers.js";

const DEFAULT_MAX_IMAGES = 20;
const DEFAULT_PROMPT = "Describe the image.";

export type ImageSandboxConfig = {
  root: string;
  bridge: SandboxFsBridge;
};

export type LoadedImageInput = {
  buffer: Buffer;
  mimeType: string;
  resolvedImage: string;
  rewrittenFrom?: string;
};

export function pickMaxBytes(cfg?: { agents?: { defaults?: { mediaMaxMb?: number } } }, maxBytesMb?: number) {
  if (typeof maxBytesMb === "number" && Number.isFinite(maxBytesMb) && maxBytesMb > 0) {
    return Math.floor(maxBytesMb * 1024 * 1024);
  }
  const configured = cfg?.agents?.defaults?.mediaMaxMb;
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured * 1024 * 1024);
  }
  return undefined;
}

export function normalizeImageToolInput(args: Record<string, unknown>) {
  const imageCandidates: string[] = [];
  if (typeof args.image === "string") {
    imageCandidates.push(args.image);
  }
  if (Array.isArray(args.images)) {
    imageCandidates.push(...args.images.filter((v): v is string => typeof v === "string"));
  }

  const seenImages = new Set<string>();
  const imageInputs: string[] = [];
  for (const candidate of imageCandidates) {
    const trimmedCandidate = candidate.trim();
    const normalizedForDedupe = trimmedCandidate.startsWith("@")
      ? trimmedCandidate.slice(1).trim()
      : trimmedCandidate;
    if (!normalizedForDedupe || seenImages.has(normalizedForDedupe)) {
      continue;
    }
    seenImages.add(normalizedForDedupe);
    imageInputs.push(trimmedCandidate);
  }
  if (imageInputs.length === 0) {
    throw new Error("image required");
  }

  const maxImagesRaw = typeof args.maxImages === "number" ? args.maxImages : undefined;
  const maxImages =
    typeof maxImagesRaw === "number" && Number.isFinite(maxImagesRaw) && maxImagesRaw > 0
      ? Math.floor(maxImagesRaw)
      : DEFAULT_MAX_IMAGES;
  if (imageInputs.length > maxImages) {
    return {
      ok: false as const,
      result: {
        content: [
          {
            type: "text" as const,
            text: `Too many images: ${imageInputs.length} provided, maximum is ${maxImages}. Please reduce the number of images.`,
          },
        ],
        details: { error: "too_many_images", count: imageInputs.length, max: maxImages },
      },
    };
  }

  const { prompt: promptRaw, modelOverride } = resolvePromptAndModelOverride(args, DEFAULT_PROMPT);
  const maxBytesMb = typeof args.maxBytesMb === "number" ? args.maxBytesMb : undefined;
  return {
    ok: true as const,
    imageInputs,
    promptRaw,
    modelOverride,
    maxBytesMb,
  };
}

export async function loadImageToolInputs(params: {
  imageInputs: string[];
  workspaceDir?: string;
  maxBytes?: number;
  sandbox?: ImageSandboxConfig;
  fsPolicy?: ToolFsPolicy;
}) {
  const sandboxConfig: SandboxedBridgeMediaPathConfig | null =
    params.sandbox?.root?.trim()
      ? {
          root: params.sandbox.root.trim(),
          bridge: params.sandbox.bridge,
          workspaceOnly: params.fsPolicy?.workspaceOnly === true,
        }
      : null;

  const loadedImages: LoadedImageInput[] = [];
  for (const imageRawInput of params.imageInputs) {
    const trimmed = imageRawInput.trim();
    const imageRaw = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
    if (!imageRaw) {
      throw new Error("image required (empty string in array)");
    }

    const looksLikeWindowsDrivePath = /^[a-zA-Z]:[\\/]/.test(imageRaw);
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(imageRaw);
    const isFileUrl = /^file:/i.test(imageRaw);
    const isHttpUrl = /^https?:\/\//i.test(imageRaw);
    const isDataUrl = /^data:/i.test(imageRaw);
    if (hasScheme && !looksLikeWindowsDrivePath && !isFileUrl && !isHttpUrl && !isDataUrl) {
      return {
        ok: false as const,
        result: {
          content: [
            {
              type: "text" as const,
              text: `Unsupported image reference: ${imageRawInput}. Use a file path, a file:// URL, a data: URL, or an http(s) URL.`,
            },
          ],
          details: {
            error: "unsupported_image_reference",
            image: imageRawInput,
          },
        },
      };
    }

    if (sandboxConfig && isHttpUrl) {
      throw new Error("Sandboxed image tool does not allow remote URLs.");
    }

    const resolvedImage = (() => {
      if (sandboxConfig) {
        return imageRaw;
      }
      if (imageRaw.startsWith("~")) {
        return resolveUserPath(imageRaw);
      }
      if (
        !isDataUrl &&
        !isFileUrl &&
        !isHttpUrl &&
        !looksLikeWindowsDrivePath &&
        !isAbsolute(imageRaw) &&
        params.workspaceDir
      ) {
        return resolve(params.workspaceDir, imageRaw);
      }
      return imageRaw;
    })();
    const resolvedPathInfo: { resolved: string; rewrittenFrom?: string } = isDataUrl
      ? { resolved: "" }
      : sandboxConfig
        ? await resolveSandboxedBridgeMediaPath({
            sandbox: sandboxConfig,
            mediaPath: resolvedImage,
            inboundFallbackDir: "media/inbound",
          })
        : {
            resolved: resolvedImage.startsWith("file://")
              ? resolvedImage.slice("file://".length)
              : resolvedImage,
          };
    const resolvedPath = isDataUrl ? null : resolvedPathInfo.resolved;
    const mediaLocalRoots =
      params.fsPolicy?.workspaceOnly === true
        ? resolveMediaToolLocalRoots(
            params.workspaceDir,
            {
              workspaceOnly: true,
            },
            resolvedPath ? [resolvedPath] : undefined,
          )
        : resolvedPath
          ? Array.from(
              new Set([
                ...resolveMediaToolLocalRoots(params.workspaceDir, undefined, [resolvedPath]),
                dirname(resolvedPath),
              ]),
            )
          : resolveMediaToolLocalRoots(params.workspaceDir);

    const media = isDataUrl
      ? decodeDataUrl(resolvedImage)
      : sandboxConfig
        ? await loadWebMedia(resolvedPath ?? resolvedImage, {
            maxBytes: params.maxBytes,
            sandboxValidated: true,
            readFile: createSandboxBridgeReadFile({ sandbox: sandboxConfig }),
          })
        : await loadWebMedia(resolvedPath ?? resolvedImage, {
            maxBytes: params.maxBytes,
            localRoots: mediaLocalRoots,
          });
    if (media.kind !== "image") {
      throw new Error(`Unsupported media type: ${media.kind}`);
    }

    const mimeType =
      ("contentType" in media && media.contentType) ||
      ("mimeType" in media && media.mimeType) ||
      "image/png";
    loadedImages.push({
      buffer: media.buffer,
      mimeType,
      resolvedImage,
      ...(resolvedPathInfo.rewrittenFrom ? { rewrittenFrom: resolvedPathInfo.rewrittenFrom } : {}),
    });
  }

  return { ok: true as const, loadedImages };
}

export function buildImageToolResultDetails(loadedImages: LoadedImageInput[]) {
  return loadedImages.length === 1
    ? {
        image: loadedImages[0].resolvedImage,
        ...(loadedImages[0].rewrittenFrom ? { rewrittenFrom: loadedImages[0].rewrittenFrom } : {}),
      }
    : {
        images: loadedImages.map((img) => ({
          image: img.resolvedImage,
          ...(img.rewrittenFrom ? { rewrittenFrom: img.rewrittenFrom } : {}),
        })),
      };
}
