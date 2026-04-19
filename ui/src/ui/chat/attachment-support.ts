export const CHAT_ATTACHMENT_ACCEPT = "image/*";
export const CHAT_COMPOSER_ATTACHMENT_ACCEPT = [
  "image/*",
  "audio/*",
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".log",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".sh",
  ".sql",
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".ogg",
  ".opus",
  ".m4a",
].join(",");

export type ChatComposerAttachmentKind = "image" | "text" | "pdf" | "audio";

const TEXT_ATTACHMENT_MIME_PREFIXES = ["text/"];
const TEXT_ATTACHMENT_MIMES = new Set([
  "application/json",
  "application/ld+json",
  "application/x-ndjson",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/x-javascript",
  "application/sql",
  "application/typescript",
  "application/x-sh",
]);
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "csv",
  "log",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "sh",
  "sql",
]);

const AUDIO_ATTACHMENT_MIMES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/aac",
  "audio/ogg",
  "audio/opus",
  "audio/mp4",
  "audio/x-m4a",
  "audio/m4a",
]);
const AUDIO_ATTACHMENT_EXTENSIONS = new Set(["mp3", "wav", "flac", "aac", "ogg", "opus", "m4a"]);

export function isSupportedChatAttachmentMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
}

function isSupportedPdfAttachmentMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.toLowerCase() === "application/pdf";
}

function isSupportedAudioAttachmentMimeType(mimeType: string | null | undefined): boolean {
  if (typeof mimeType !== "string" || !mimeType.trim()) {
    return false;
  }
  const normalized = mimeType.toLowerCase();
  return normalized.startsWith("audio/") || AUDIO_ATTACHMENT_MIMES.has(normalized);
}

function fileExtension(name: string | null | undefined): string | null {
  if (typeof name !== "string") {
    return null;
  }
  const trimmed = name.trim();
  const idx = trimmed.lastIndexOf(".");
  if (idx <= 0 || idx === trimmed.length - 1) {
    return null;
  }
  return trimmed.slice(idx + 1).toLowerCase();
}

function isSupportedTextAttachmentMimeType(mimeType: string | null | undefined): boolean {
  if (typeof mimeType !== "string" || !mimeType.trim()) {
    return false;
  }
  const normalized = mimeType.toLowerCase();
  if (TEXT_ATTACHMENT_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return true;
  }
  return TEXT_ATTACHMENT_MIMES.has(normalized);
}

export function getSupportedComposerAttachmentKind(file: {
  type?: string | null | undefined;
  name?: string | null | undefined;
}): ChatComposerAttachmentKind | null {
  if (isSupportedChatAttachmentMimeType(file.type)) {
    return "image";
  }
  if (isSupportedPdfAttachmentMimeType(file.type)) {
    return "pdf";
  }
  if (isSupportedAudioAttachmentMimeType(file.type)) {
    return "audio";
  }
  if (isSupportedTextAttachmentMimeType(file.type)) {
    return "text";
  }
  const extension = fileExtension(file.name);
  if (extension === "pdf") {
    return "pdf";
  }
  if (extension && AUDIO_ATTACHMENT_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (extension && TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return null;
}
