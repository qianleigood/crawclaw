const OPUS_CHANNELS = new Set<string>();

function resolveChannelId(channel: string | undefined): string | null {
  if (!channel) {
    return null;
  }
  const fallback = channel.trim().toLowerCase();
  return fallback || null;
}

export function resolveTtsTargetForChannel(channel?: string): "audio-file" | "voice-note" {
  const channelId = resolveChannelId(channel);
  return channelId && OPUS_CHANNELS.has(channelId) ? "voice-note" : "audio-file";
}
