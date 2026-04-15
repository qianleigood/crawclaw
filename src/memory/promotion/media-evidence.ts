import type { RuntimeStore } from "../runtime/runtime-store.ts";
import type { MessageBlock } from "../types/media.ts";
import type { PromotionMessageLike, PromotionSourceRef } from "./types.ts";

export interface PromotionMediaEvidenceItem {
  mediaId?: string | null;
  blockType: "image" | "file";
  sourceRefId: string;
  role?: string;
  turnIndex?: number;
  url?: string;
  path?: string;
  mimeType?: string;
  title?: string;
  alt?: string;
  caption?: string;
  isPrimary: boolean;
}

function dedupeKey(item: PromotionMediaEvidenceItem): string {
  return [
    item.mediaId ?? "",
    item.blockType,
    item.url ?? "",
    item.path ?? "",
    item.mimeType ?? "",
    item.title ?? "",
  ].join("|");
}

function isImageBlock(block: MessageBlock): block is Extract<MessageBlock, { type: "image" }> {
  return block.type === "image";
}

function isFileBlock(block: MessageBlock): block is Extract<MessageBlock, { type: "file" }> {
  return block.type === "file";
}

export function collectMediaEvidenceFromMessages(
  messages: PromotionMessageLike[],
  preferredPrimaryMediaId?: string | null,
): PromotionMediaEvidenceItem[] {
  const items: PromotionMediaEvidenceItem[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    const blocks = message.contentBlocks ?? [];
    const primaryFromMessage = message.primaryMediaId ?? null;
    for (const block of blocks) {
      const item = isImageBlock(block)
        ? {
            mediaId: block.mediaId ?? primaryFromMessage,
            blockType: "image" as const,
            sourceRefId: message.id ?? `turn:${message.turnIndex ?? "unknown"}`,
            role: message.role,
            turnIndex: message.turnIndex,
            url: block.url,
            mimeType: block.mimeType,
            title: block.caption ?? block.alt ?? block.url,
            alt: block.alt,
            caption: block.caption,
            isPrimary: Boolean((block.mediaId && preferredPrimaryMediaId && block.mediaId === preferredPrimaryMediaId) || (primaryFromMessage && (block.mediaId ?? primaryFromMessage) === primaryFromMessage)),
          }
        : isFileBlock(block)
          ? {
              mediaId: block.mediaId ?? primaryFromMessage,
              blockType: "file" as const,
              sourceRefId: message.id ?? `turn:${message.turnIndex ?? "unknown"}`,
              role: message.role,
              turnIndex: message.turnIndex,
              path: block.path,
              mimeType: block.mimeType,
              title: block.title ?? block.name ?? block.path,
              isPrimary: Boolean((block.mediaId && preferredPrimaryMediaId && block.mediaId === preferredPrimaryMediaId) || (primaryFromMessage && (block.mediaId ?? primaryFromMessage) === primaryFromMessage)),
            }
          : null;
      if (!item) {continue;}
      const key = dedupeKey(item);
      if (seen.has(key)) {continue;}
      seen.add(key);
      items.push(item);
    }
  }

  if (preferredPrimaryMediaId) {
    const explicitPrimary = items.find((item) => item.mediaId === preferredPrimaryMediaId);
    if (explicitPrimary) {
      explicitPrimary.isPrimary = true;
      for (const item of items) {
        if (item !== explicitPrimary) {item.isPrimary = false;}
      }
    }
  }

  if (!items.some((item) => item.isPrimary) && items.length) {
    items[0].isPrimary = true;
  }

  return items;
}

export async function loadMediaMessagesFromSourceRefs(
  runtimeStore: RuntimeStore,
  sessionId: string | null | undefined,
  sourceRefs: PromotionSourceRef[],
): Promise<PromotionMessageLike[]> {
  if (!sessionId) {return [];}
  const windows = sourceRefs
    .filter((ref) => ref.kind === "window" && typeof ref.startTurn === "number" && typeof ref.endTurn === "number")
    .map((ref) => ({ startTurn: ref.startTurn!, endTurn: ref.endTurn! }));

  if (!windows.length) {return [];}

  const rows = await Promise.all(
    windows.map((window) => runtimeStore.listMessagesByTurnRange(sessionId, window.startTurn, window.endTurn)),
  );

  const out: PromotionMessageLike[] = [];
  const seen = new Set<string>();
  for (const row of rows.flat()) {
    if (seen.has(row.id)) {continue;}
    seen.add(row.id);
    out.push({
      id: row.id,
      role: row.role,
      content: row.content,
      contentBlocks: row.contentBlocks,
      hasMedia: row.hasMedia,
      primaryMediaId: row.primaryMediaId,
      mediaRefs: row.mediaRefs,
      turnIndex: row.turnIndex,
      createdAt: row.createdAt,
    });
  }
  return out.toSorted((a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0));
}
