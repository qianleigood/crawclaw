import type { MemoryRuntimeConfig } from "../types/config.ts";
import type { GmMessageRow } from "../types/runtime.ts";
import type { RuntimeStore } from "../runtime/runtime-store.ts";
import { MediaService } from "../media/media-service.ts";
import { normalizeIncomingMessage } from "../util/message.ts";

export interface IngestCoordinatorOptions {
  runtimeStore: RuntimeStore;
  mediaService?: MediaService;
  config?: MemoryRuntimeConfig;
}

export class IngestCoordinator {
  private readonly mediaService: MediaService;

  constructor(private readonly options: IngestCoordinatorOptions) {
    this.mediaService = options.mediaService ?? new MediaService({
      cacheRoot: options.config?.multimodal.storage.cacheDir,
      maxAssetBytes: options.config?.multimodal.storage.maxAssetBytes,
    });
  }

  async ingestMessage(input: {
    sessionId: string;
    conversationUid: string;
    role?: string;
    message: unknown;
    turnIndex: number;
    sourceType: string;
    createdAt?: number;
    sourceRef?: string | null;
  }): Promise<GmMessageRow> {
    const rawMessage =
      input.message && typeof input.message === "object"
        ? { ...(input.message as Record<string, unknown>) }
        : {};
    const normalized = normalizeIncomingMessage({
      ...rawMessage,
      role: input.role ?? (rawMessage.role as string | undefined) ?? "unknown",
      content: rawMessage.content,
    });
    const media = await this.mediaService.ingestBlocks(normalized.contentBlocks);
    for (const asset of media.mediaAssets) {
      await this.options.runtimeStore.upsertMediaAsset?.(asset);
    }
    await this.options.runtimeStore.appendMessage({
      sessionId: input.sessionId,
      conversationUid: input.conversationUid,
      role: normalized.role,
      content: normalized.content,
      contentText: normalized.contentText,
      contentBlocks: media.blocks,
      hasMedia: media.hasMedia,
      primaryMediaId: media.primaryMediaId,
      mediaRefs: media.mediaRefs,
      runtimeMeta: normalized.runtimeMeta,
      runtimeShape: normalized.runtimeShape,
      turnIndex: input.turnIndex,
      createdAt: input.createdAt,
    });
    await this.options.runtimeStore.appendRawEvent?.({
      sourceType: input.sourceType,
      sessionId: input.sessionId,
      conversationUid: input.conversationUid,
      turnIndex: input.turnIndex,
      contentText: normalized.contentText,
      contentBlocks: media.blocks,
      hasMedia: media.hasMedia,
      primaryMediaId: media.primaryMediaId,
      sourceRef: input.sourceRef ?? null,
      status: "normalized",
      createdAt: input.createdAt,
    });
    return {
      id: `msg_turn_${input.turnIndex}`,
      sessionId: input.sessionId,
      conversationUid: input.conversationUid,
      role: normalized.role,
      content: normalized.content,
      contentText: normalized.contentText,
      contentBlocks: media.blocks,
      hasMedia: media.hasMedia,
      primaryMediaId: media.primaryMediaId,
      mediaRefs: media.mediaRefs,
      runtimeMeta: normalized.runtimeMeta,
      runtimeShape: normalized.runtimeShape,
      turnIndex: input.turnIndex,
      extracted: false,
      createdAt: input.createdAt ?? Date.now(),
    };
  }
}
