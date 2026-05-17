export type OutboundReplyPayloadLike = {
  text?: string;
  mediaUrls?: string[];
  mediaUrl?: string;
  replyToId?: string;
};

/** Detect numeric-looking target ids for channels that distinguish ids from handles. */
export function isNumericTargetId(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return false;
  }
  return /^\d{3,}$/.test(trimmed);
}

/** Append attachment links to plain text when the channel cannot send media inline. */
export function formatTextWithAttachmentLinks(
  text: string | undefined,
  mediaUrls: readonly string[],
): string {
  const trimmedText = text?.trim() ?? "";
  if (!trimmedText && mediaUrls.length === 0) {
    return "";
  }
  const mediaBlock = mediaUrls.length
    ? mediaUrls.map((url) => `Attachment: ${url}`).join("\n")
    : "";
  if (!trimmedText) {
    return mediaBlock;
  }
  if (!mediaBlock) {
    return trimmedText;
  }
  return `${trimmedText}\n\n${mediaBlock}`;
}

/** Send a caption with only the first media item, mirroring caption-limited channel transports. */
export async function sendMediaWithLeadingCaption(params: {
  mediaUrls: readonly string[];
  caption: string;
  send: (payload: { mediaUrl: string; caption?: string }) => Promise<void>;
  onError?: (params: {
    error: unknown;
    mediaUrl: string;
    caption?: string;
    index: number;
    isFirst: boolean;
  }) => Promise<void> | void;
}): Promise<boolean> {
  if (params.mediaUrls.length === 0) {
    return false;
  }

  for (const [index, mediaUrl] of params.mediaUrls.entries()) {
    const isFirst = index === 0;
    const caption = isFirst ? params.caption : undefined;
    try {
      await params.send({ mediaUrl, caption });
    } catch (error) {
      if (params.onError) {
        await params.onError({
          error,
          mediaUrl,
          caption,
          index,
          isFirst,
        });
        continue;
      }
      throw error;
    }
  }
  return true;
}
