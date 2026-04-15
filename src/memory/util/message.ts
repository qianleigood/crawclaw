import type { MessageBlock } from "../types/media.ts";
import type {
  MessageRuntimeMeta,
  MessageRuntimeShape,
  MessageRuntimeShapeBlock,
} from "../types/runtime.ts";

function toTextBlock(text: string): MessageBlock {
  return { type: "text", text };
}

function imageBlockFromRecord(rec: Record<string, unknown>): MessageBlock | null {
  const directUrl =
    typeof rec.url === "string"
      ? rec.url
      : typeof rec.image === "string"
        ? rec.image
        : typeof rec.image_url === "string"
          ? rec.image_url
          : null;
  const nestedUrl =
    rec.image_url && typeof rec.image_url === "object"
      ? (() => {
          const nested = rec.image_url as Record<string, unknown>;
          return typeof nested.url === "string" ? nested.url : null;
        })()
      : null;
  const url = directUrl ?? nestedUrl;
  if (!url) {
    return null;
  }
  return {
    type: "image",
    url,
    alt:
      typeof rec.alt === "string"
        ? rec.alt
        : typeof rec.imageAlt === "string"
          ? rec.imageAlt
          : undefined,
    mimeType: typeof rec.mimeType === "string" ? rec.mimeType : undefined,
    caption: typeof rec.caption === "string" ? rec.caption : undefined,
  };
}

function fileBlockFromRecord(rec: Record<string, unknown>): MessageBlock | null {
  const path =
    typeof rec.path === "string"
      ? rec.path
      : typeof rec.file === "string"
        ? rec.file
        : typeof rec.file_path === "string"
          ? rec.file_path
          : null;
  if (!path) {
    return null;
  }
  return {
    type: "file",
    path,
    name:
      typeof rec.name === "string"
        ? rec.name
        : typeof rec.fileName === "string"
          ? rec.fileName
          : undefined,
    mimeType: typeof rec.mimeType === "string" ? rec.mimeType : undefined,
    title: typeof rec.title === "string" ? rec.title : undefined,
  };
}

function linkBlockFromRecord(rec: Record<string, unknown>): MessageBlock | null {
  const url = typeof rec.url === "string" ? rec.url : null;
  if (!url) {
    return null;
  }
  return {
    type: "link",
    url,
    title: typeof rec.title === "string" ? rec.title : undefined,
  };
}

function blockFromUnknown(block: unknown): MessageBlock[] {
  if (typeof block === "string") {
    return block.trim() ? [toTextBlock(block)] : [];
  }
  if (!block || typeof block !== "object") {
    return [];
  }
  const rec = block as Record<string, unknown>;
  const type =
    typeof rec.type === "string" ? rec.type : typeof rec.kind === "string" ? rec.kind : "";

  if (type === "text") {
    const text =
      typeof rec.text === "string" ? rec.text : typeof rec.content === "string" ? rec.content : "";
    return text.trim() ? [toTextBlock(text)] : [];
  }
  if (type === "image" || type === "input_image" || type === "image_url") {
    const imageBlock = imageBlockFromRecord(rec);
    return imageBlock ? [imageBlock] : [];
  }
  if (type === "file" || type === "attachment" || type === "input_file") {
    const fileBlock = fileBlockFromRecord(rec);
    return fileBlock ? [fileBlock] : [];
  }
  if (type === "link") {
    const linkBlock = linkBlockFromRecord(rec);
    return linkBlock ? [linkBlock] : [];
  }

  const imageFallback = imageBlockFromRecord(rec);
  if (imageFallback) {
    return [imageFallback];
  }
  const fileFallback = fileBlockFromRecord(rec);
  if (fileFallback) {
    return [fileFallback];
  }
  const text =
    typeof rec.text === "string" ? rec.text : typeof rec.content === "string" ? rec.content : "";
  return text.trim() ? [toTextBlock(text)] : [];
}

function pushUniqueValue(target: string[], seen: Set<string>, value: unknown) {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed || seen.has(trimmed)) {
    return;
  }
  seen.add(trimmed);
  target.push(trimmed);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function extractProviderMessageId(message: unknown): string | null {
  const record = asRecord(message);
  const metadata = asRecord(record.metadata);
  const nestedMessage = asRecord(record.message);
  const candidates = [
    record.id,
    record.messageId,
    metadata.messageId,
    metadata.providerMessageId,
    nestedMessage.id,
    nestedMessage.messageId,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function sanitizeRuntimeShapeBlock(block: unknown): MessageRuntimeShapeBlock[] {
  if (typeof block === "string") {
    return block.trim() ? [{ type: "text", text: block }] : [];
  }
  if (!block || typeof block !== "object") {
    return [];
  }
  const rec = block as Record<string, unknown>;
  const type =
    typeof rec.type === "string" ? rec.type : typeof rec.kind === "string" ? rec.kind : "";
  if (!type) {
    return [];
  }

  if (type === "text" || type === "input_text" || type === "output_text") {
    const text =
      typeof rec.text === "string" ? rec.text : typeof rec.content === "string" ? rec.content : "";
    return text.trim() ? [{ type, text }] : [];
  }

  if (type === "toolCall" || type === "toolUse" || type === "functionCall") {
    const out: MessageRuntimeShapeBlock = { type };
    if (typeof rec.id === "string" && rec.id.trim()) {
      out.id = rec.id.trim();
    }
    if (typeof rec.name === "string" && rec.name.trim()) {
      out.name = rec.name.trim();
    }
    if (rec.arguments !== undefined) {
      out.arguments = rec.arguments;
    }
    if (rec.input !== undefined) {
      out.input = rec.input;
    }
    if (rec.partialJson !== undefined) {
      out.partialJson = rec.partialJson;
    }
    return [out];
  }

  if (type === "tool_result" || type === "toolResult") {
    const out: MessageRuntimeShapeBlock = { type };
    if (typeof rec.tool_use_id === "string" && rec.tool_use_id.trim()) {
      out.tool_use_id = rec.tool_use_id.trim();
    }
    if (typeof rec.toolUseId === "string" && rec.toolUseId.trim()) {
      out.toolUseId = rec.toolUseId.trim();
    }
    if (typeof rec.is_error === "boolean") {
      out.is_error = rec.is_error;
    }
    if (typeof rec.isError === "boolean") {
      out.isError = rec.isError;
    }
    if (typeof rec.content === "string") {
      out.content = rec.content;
    } else if (Array.isArray(rec.content)) {
      out.content = rec.content.flatMap((item) => sanitizeRuntimeShapeBlock(item));
    }
    return [out];
  }

  if (type === "thinking" || type === "redacted_thinking") {
    const out: MessageRuntimeShapeBlock = { type };
    if (typeof rec.thinking === "string") {
      out.thinking = rec.thinking;
    }
    if (rec.redacted_thinking !== undefined) {
      out.redacted_thinking = rec.redacted_thinking;
    }
    if (typeof rec.thinkingSignature === "string" && rec.thinkingSignature.trim()) {
      out.thinkingSignature = rec.thinkingSignature.trim();
    }
    if (typeof rec.thought_signature === "string" && rec.thought_signature.trim()) {
      out.thought_signature = rec.thought_signature.trim();
    }
    if (typeof rec.summary === "string" && rec.summary.trim()) {
      out.summary = rec.summary.trim();
    }
    return [out];
  }

  if (type === "image" || type === "input_image" || type === "image_url") {
    const out: MessageRuntimeShapeBlock = { type };
    const url =
      typeof rec.url === "string"
        ? rec.url
        : rec.source &&
            typeof rec.source === "object" &&
            typeof (rec.source as Record<string, unknown>).url === "string"
          ? ((rec.source as Record<string, unknown>).url as string)
          : undefined;
    if (url) {
      out.url = url;
    }
    if (typeof rec.mimeType === "string" && rec.mimeType.trim()) {
      out.mimeType = rec.mimeType.trim();
    }
    if (rec.source && typeof rec.source === "object") {
      const source = rec.source as Record<string, unknown>;
      if (
        typeof source.type === "string" &&
        source.type === "url" &&
        typeof source.url === "string"
      ) {
        out.source = { type: "url", url: source.url };
      }
    }
    return [out];
  }

  if (
    type === "file" ||
    type === "attachment" ||
    type === "input_file" ||
    type === "document" ||
    type === "link"
  ) {
    const out: MessageRuntimeShapeBlock = { type };
    for (const key of ["path", "file_path", "url", "name", "title", "mimeType", "media_type"]) {
      const value = rec[key];
      if (typeof value === "string" && value.trim()) {
        out[key] = value.trim();
      }
    }
    return [out];
  }

  const out: MessageRuntimeShapeBlock = { type };
  for (const [key, value] of Object.entries(rec)) {
    if (key === "type" || key === "kind") {
      continue;
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    }
  }
  return [out];
}

function extractMessageRuntimeShape(message: unknown, role?: string): MessageRuntimeShape | null {
  const record = asRecord(message);
  const metadata = asRecord(record.metadata);
  const content =
    typeof record.content === "string"
      ? sanitizeRuntimeShapeBlock(record.content)
      : Array.isArray(record.content)
        ? record.content.flatMap((block: unknown) => sanitizeRuntimeShapeBlock(block))
        : [];

  const messageId = extractProviderMessageId(message);
  const messageUuid =
    typeof record.uuid === "string" && record.uuid.trim()
      ? record.uuid.trim()
      : typeof metadata.uuid === "string" && metadata.uuid.trim()
        ? metadata.uuid.trim()
        : null;
  const stopReason =
    typeof record.stopReason === "string" && record.stopReason.trim()
      ? record.stopReason.trim()
      : null;
  const toolCallId =
    typeof record.toolCallId === "string" && record.toolCallId.trim()
      ? record.toolCallId.trim()
      : typeof record.toolUseId === "string" && record.toolUseId.trim()
        ? record.toolUseId.trim()
        : null;
  const toolName =
    typeof record.toolName === "string" && record.toolName.trim() ? record.toolName.trim() : null;
  const isError = typeof record.isError === "boolean" ? record.isError : null;
  const resolvedRole = typeof role === "string" && role.trim() ? role.trim() : undefined;

  if (
    !messageId &&
    !messageUuid &&
    !stopReason &&
    !toolCallId &&
    !toolName &&
    isError == null &&
    !content.length &&
    !resolvedRole
  ) {
    return null;
  }

  return {
    ...(messageId ? { messageId } : {}),
    ...(messageUuid ? { messageUuid } : {}),
    ...(stopReason ? { stopReason } : {}),
    ...(toolCallId ? { toolCallId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(isError != null ? { isError } : {}),
    ...(content.length ? { content } : {}),
  };
}

export function extractMessageRuntimeMeta(
  message: unknown,
  role?: string,
): MessageRuntimeMeta | null {
  const record = asRecord(message);
  const toolUseIds: string[] = [];
  const toolResultIds: string[] = [];
  const thinkingSignatures: string[] = [];
  const toolUseSeen = new Set<string>();
  const toolResultSeen = new Set<string>();
  const thinkingSeen = new Set<string>();
  const resolvedRole = typeof role === "string" && role.trim() ? role.trim() : undefined;

  const content = record.content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const rec = block as Record<string, unknown>;
      const type =
        typeof rec.type === "string" ? rec.type : typeof rec.kind === "string" ? rec.kind : "";
      if (type === "toolCall" || type === "toolUse" || type === "functionCall") {
        pushUniqueValue(toolUseIds, toolUseSeen, rec.id);
      }
      if (type === "tool_result" || type === "toolResult") {
        pushUniqueValue(toolResultIds, toolResultSeen, rec.tool_use_id);
        pushUniqueValue(toolResultIds, toolResultSeen, rec.toolUseId);
      }
      if (type === "thinking") {
        pushUniqueValue(thinkingSignatures, thinkingSeen, rec.thinkingSignature);
      }
    }
  }

  if (resolvedRole === "toolResult") {
    pushUniqueValue(toolResultIds, toolResultSeen, record.toolCallId);
    pushUniqueValue(toolResultIds, toolResultSeen, record.toolUseId);
  }

  const providerMessageId = extractProviderMessageId(message);
  if (
    !providerMessageId &&
    !toolUseIds.length &&
    !toolResultIds.length &&
    !thinkingSignatures.length
  ) {
    return null;
  }

  return {
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(toolUseIds.length ? { toolUseIds } : {}),
    ...(toolResultIds.length ? { toolResultIds } : {}),
    ...(thinkingSignatures.length ? { thinkingSignatures } : {}),
  };
}

export function extractMessageBlocks(content: unknown): MessageBlock[] {
  if (typeof content === "string") {
    return content.trim() ? [toTextBlock(content)] : [];
  }
  if (Array.isArray(content)) {
    return content.flatMap((item) => blockFromUnknown(item));
  }
  return blockFromUnknown(content);
}

export function contentToText(content: unknown): string {
  const blocks = extractMessageBlocks(content);
  return blocks
    .map((block) => {
      if (block.type === "text") {
        return block.text;
      }
      if (block.type === "image") {
        return block.alt || block.caption || "";
      }
      if (block.type === "file") {
        return block.title || block.name || block.path;
      }
      if (block.type === "link") {
        return block.title || block.url;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

export function normalizeMessageContent(message: unknown): string {
  const record = asRecord(message);
  const role = typeof record.role === "string" ? record.role : "unknown";
  const text = contentToText(record.content).trim();
  return text ? text : `[${role}]`;
}

export function normalizeIncomingMessage(message: unknown): {
  role: string;
  content: string;
  contentText: string;
  contentBlocks: MessageBlock[];
  runtimeMeta: MessageRuntimeMeta | null;
  runtimeShape: MessageRuntimeShape | null;
} {
  const record = asRecord(message);
  const role = typeof record.role === "string" ? record.role : "unknown";
  const contentBlocks = extractMessageBlocks(record.content);
  const contentText = contentToText(record.content).trim() || `[${role}]`;
  const runtimeMeta = extractMessageRuntimeMeta(message, role);
  const runtimeShape = extractMessageRuntimeShape(message, role);
  return {
    role,
    content: contentText,
    contentText,
    contentBlocks: contentBlocks.length ? contentBlocks : [toTextBlock(contentText)],
    runtimeMeta,
    runtimeShape,
  };
}
