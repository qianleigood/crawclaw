import { loadWebMediaRaw } from "../../media/web-media.js";
import { resolveUserPath } from "../../utils.js";
import { resolvePromptAndModelOverride } from "./media-tool-shared.js";
import {
  createSandboxBridgeReadFile,
  resolveSandboxedBridgeMediaPath,
  type SandboxedBridgeMediaPathConfig,
  type SandboxFsBridge,
  type ToolFsPolicy,
} from "./tool-runtime.helpers.js";
import { resolveMediaToolLocalRoots } from "./media-tool-shared.js";

const DEFAULT_MAX_PDFS = 10;
const DEFAULT_PROMPT = "Analyze this PDF document.";

export type PdfSandboxConfig = {
  root: string;
  bridge: SandboxFsBridge;
};

export type LoadedPdfInput = {
  base64: string;
  buffer: Buffer;
  filename: string;
  resolvedPath: string;
  rewrittenFrom?: string;
};

export function normalizePdfToolInput(params: {
  args: Record<string, unknown>;
  configuredMaxBytesMb: number;
}) {
  const pdfCandidates: string[] = [];
  if (typeof params.args.pdf === "string") {
    pdfCandidates.push(params.args.pdf);
  }
  if (Array.isArray(params.args.pdfs)) {
    pdfCandidates.push(...params.args.pdfs.filter((v): v is string => typeof v === "string"));
  }

  const seenPdfs = new Set<string>();
  const pdfInputs: string[] = [];
  for (const candidate of pdfCandidates) {
    const trimmed = candidate.trim();
    if (!trimmed || seenPdfs.has(trimmed)) {
      continue;
    }
    seenPdfs.add(trimmed);
    pdfInputs.push(trimmed);
  }
  if (pdfInputs.length === 0) {
    throw new Error("pdf required: provide a path or URL to a PDF document");
  }
  if (pdfInputs.length > DEFAULT_MAX_PDFS) {
    return {
      ok: false as const,
      result: {
        content: [
          {
            type: "text" as const,
            text: `Too many PDFs: ${pdfInputs.length} provided, maximum is ${DEFAULT_MAX_PDFS}. Please reduce the number.`,
          },
        ],
        details: { error: "too_many_pdfs", count: pdfInputs.length, max: DEFAULT_MAX_PDFS },
      },
    };
  }

  const { prompt: promptRaw, modelOverride } = resolvePromptAndModelOverride(
    params.args,
    DEFAULT_PROMPT,
  );
  const maxBytesMbRaw =
    typeof params.args.maxBytesMb === "number" ? params.args.maxBytesMb : undefined;
  const maxBytesMb =
    typeof maxBytesMbRaw === "number" && Number.isFinite(maxBytesMbRaw) && maxBytesMbRaw > 0
      ? maxBytesMbRaw
      : params.configuredMaxBytesMb;
  const maxBytes = Math.floor(maxBytesMb * 1024 * 1024);
  const pagesRaw =
    typeof params.args.pages === "string" && params.args.pages.trim()
      ? params.args.pages.trim()
      : undefined;

  return {
    ok: true as const,
    pdfInputs,
    promptRaw,
    modelOverride,
    maxBytes,
    pagesRaw,
  };
}

export async function loadPdfToolDocuments(params: {
  pdfInputs: string[];
  maxBytes: number;
  workspaceDir?: string;
  sandbox?: PdfSandboxConfig;
  fsPolicy?: ToolFsPolicy;
}) {
  const sandboxConfig: SandboxedBridgeMediaPathConfig | null =
    params.sandbox && params.sandbox.root.trim()
      ? {
          root: params.sandbox.root.trim(),
          bridge: params.sandbox.bridge,
          workspaceOnly: params.fsPolicy?.workspaceOnly === true,
        }
      : null;

  const loadedPdfs: LoadedPdfInput[] = [];
  for (const pdfRaw of params.pdfInputs) {
    const trimmed = pdfRaw.trim();
    const isHttpUrl = /^https?:\/\//i.test(trimmed);
    const isFileUrl = /^file:/i.test(trimmed);
    const isDataUrl = /^data:/i.test(trimmed);
    const looksLikeWindowsDrive = /^[a-zA-Z]:[\\/]/.test(trimmed);
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);

    if (hasScheme && !looksLikeWindowsDrive && !isFileUrl && !isHttpUrl && !isDataUrl) {
      return {
        ok: false as const,
        result: {
          content: [
            {
              type: "text" as const,
              text: `Unsupported PDF reference: ${pdfRaw}. Use a file path, file:// URL, or http(s) URL.`,
            },
          ],
          details: { error: "unsupported_pdf_reference", pdf: pdfRaw },
        },
      };
    }

    if (sandboxConfig && isHttpUrl) {
      throw new Error("Sandboxed PDF tool does not allow remote URLs.");
    }

    const resolvedPdf = (() => {
      if (sandboxConfig) {
        return trimmed;
      }
      if (trimmed.startsWith("~")) {
        return resolveUserPath(trimmed);
      }
      return trimmed;
    })();

    const resolvedPathInfo: { resolved: string; rewrittenFrom?: string } = sandboxConfig
      ? await resolveSandboxedBridgeMediaPath({
          sandbox: sandboxConfig,
          mediaPath: resolvedPdf,
          inboundFallbackDir: "media/inbound",
        })
      : {
          resolved: resolvedPdf.startsWith("file://")
            ? resolvedPdf.slice("file://".length)
            : resolvedPdf,
        };
    const localRoots = resolveMediaToolLocalRoots(
      params.workspaceDir,
      {
        workspaceOnly: params.fsPolicy?.workspaceOnly === true,
      },
      [resolvedPathInfo.resolved],
    );

    const media = sandboxConfig
      ? await loadWebMediaRaw(resolvedPathInfo.resolved, {
          maxBytes: params.maxBytes,
          sandboxValidated: true,
          readFile: createSandboxBridgeReadFile({ sandbox: sandboxConfig }),
        })
      : await loadWebMediaRaw(resolvedPathInfo.resolved, {
          maxBytes: params.maxBytes,
          localRoots,
        });

    if (media.kind !== "document") {
      const ct = (media.contentType ?? "").toLowerCase();
      if (!ct.includes("pdf") && !ct.includes("application/pdf")) {
        throw new Error(`Expected PDF but got ${media.contentType ?? media.kind}: ${pdfRaw}`);
      }
    }

    const base64 = media.buffer.toString("base64");
    const filename =
      media.fileName ??
      (isHttpUrl ? (new URL(trimmed).pathname.split("/").pop() ?? "document.pdf") : "document.pdf");

    loadedPdfs.push({
      base64,
      buffer: media.buffer,
      filename,
      resolvedPath: resolvedPathInfo.resolved,
      ...(resolvedPathInfo.rewrittenFrom ? { rewrittenFrom: resolvedPathInfo.rewrittenFrom } : {}),
    });
  }

  return { ok: true as const, loadedPdfs };
}

export function buildPdfToolResultDetails(loadedPdfs: LoadedPdfInput[]) {
  return loadedPdfs.length === 1
    ? {
        pdf: loadedPdfs[0].resolvedPath,
        ...(loadedPdfs[0].rewrittenFrom ? { rewrittenFrom: loadedPdfs[0].rewrittenFrom } : {}),
      }
    : {
        pdfs: loadedPdfs.map((p) => ({
          pdf: p.resolvedPath,
          ...(p.rewrittenFrom ? { rewrittenFrom: p.rewrittenFrom } : {}),
        })),
      };
}
