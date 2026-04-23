import { tryLoadActivatedBundledPluginPublicSurfaceModuleSync } from "../../plugin-sdk/facade-runtime.js";
import type { ChannelMessageActionAdapter, ChannelMessageToolDiscovery } from "./types.js";

export type ChannelMessageToolDiscoveryAdapter = Pick<
  ChannelMessageActionAdapter,
  "describeMessageTool"
>;

type MessageToolApi = {
  describeMessageTool?: ChannelMessageToolDiscoveryAdapter["describeMessageTool"];
};

const MESSAGE_TOOL_API_ARTIFACT_BASENAME = "message-tool-api.js";
const MISSING_PUBLIC_SURFACE_PREFIX = "Unable to resolve bundled plugin public surface ";
const messageToolApiCache = new Map<string, MessageToolApi | null>();

function loadBundledChannelMessageToolApi(channelId: string): MessageToolApi | null {
  const cacheKey = channelId.trim();
  if (messageToolApiCache.has(cacheKey)) {
    return messageToolApiCache.get(cacheKey) ?? null;
  }
  try {
    const loaded = tryLoadActivatedBundledPluginPublicSurfaceModuleSync<MessageToolApi>({
      dirName: cacheKey,
      artifactBasename: MESSAGE_TOOL_API_ARTIFACT_BASENAME,
    });
    messageToolApiCache.set(cacheKey, loaded);
    return loaded;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(MISSING_PUBLIC_SURFACE_PREFIX)) {
      messageToolApiCache.set(cacheKey, null);
      return null;
    }
    throw error;
  }
}

export function resolveBundledChannelMessageToolDiscoveryAdapter(
  channelId: string,
): ChannelMessageToolDiscoveryAdapter | undefined {
  const describeMessageTool = loadBundledChannelMessageToolApi(channelId)?.describeMessageTool;
  if (typeof describeMessageTool !== "function") {
    return undefined;
  }
  return { describeMessageTool };
}

export function describeBundledChannelMessageTool(params: {
  channelId: string;
  context: Parameters<NonNullable<ChannelMessageToolDiscoveryAdapter["describeMessageTool"]>>[0];
}): ChannelMessageToolDiscovery | null | undefined {
  const describeMessageTool = loadBundledChannelMessageToolApi(
    params.channelId,
  )?.describeMessageTool;
  if (typeof describeMessageTool !== "function") {
    return undefined;
  }
  return describeMessageTool(params.context) ?? null;
}

export const __testing = {
  clearMessageToolApiCache: () => messageToolApiCache.clear(),
};
