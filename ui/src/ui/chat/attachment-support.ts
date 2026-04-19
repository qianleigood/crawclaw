export const CHAT_ATTACHMENT_ACCEPT = "image/*";
export const CHAT_COMPOSER_ATTACHMENT_ACCEPT = [
  "image/*",
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
].join(",");

export type ChatComposerAttachmentKind = "image" | "text";

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

export function isSupportedChatAttachmentMimeType(mimeType: string | null | undefined): boolean {
  return typeof mimeType === "string" && mimeType.startsWith("image/");
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
  if (isSupportedTextAttachmentMimeType(file.type)) {
    return "text";
  }
  const extension = fileExtension(file.name);
  if (extension && TEXT_ATTACHMENT_EXTENSIONS.has(extension)) {
    return "text";
  }
  return null;
}
