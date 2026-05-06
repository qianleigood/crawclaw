import { normalizeChannelId } from "crawclaw/plugin-sdk/channel-id";

const OPUS_CHANNELS = new Set(["telegram", "feishu", "whatsapp", "matrix", "esp32"]);

function resolveChannelId(channel: string | undefined): string | null {
  if (!channel) {
    return null;
  }
  const normalized = normalizeChannelId(channel);
  if (normalized) {
    return normalized;
  }
  const fallback = channel.trim().toLowerCase();
  return fallback || null;
}

export function resolveTtsTargetForChannel(channel?: string): "audio-file" | "voice-note" {
  const channelId = resolveChannelId(channel);
  return channelId && OPUS_CHANNELS.has(channelId) ? "voice-note" : "audio-file";
}
