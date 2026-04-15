export type MediaKind = "image" | "file" | "audio" | "video";

export type MediaSourceType = "message_block" | "attachment" | "notebook_embed" | "seed" | "manual";

export interface MessageTextBlock {
  type: "text";
  text: string;
}

export interface MessageImageBlock {
  type: "image";
  url: string;
  alt?: string;
  mimeType?: string;
  caption?: string;
  mediaId?: string;
}

export interface MessageFileBlock {
  type: "file";
  path: string;
  name?: string;
  mimeType?: string;
  title?: string;
  mediaId?: string;
}

export interface MessageLinkBlock {
  type: "link";
  url: string;
  title?: string;
}

export type MessageBlock = MessageTextBlock | MessageImageBlock | MessageFileBlock | MessageLinkBlock;

export interface MediaAsset {
  mediaId: string;
  kind: MediaKind;
  sourceType: MediaSourceType;
  originalUrl?: string | null;
  localPath?: string | null;
  vaultPath?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  sha256?: string | null;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  caption?: string | null;
  status: "active" | "missing" | "failed";
  createdAt: number;
  updatedAt: number;
}

export interface MessageMediaRef {
  mediaId: string;
  ordinal: number;
  role?: "primary" | "supporting";
}
