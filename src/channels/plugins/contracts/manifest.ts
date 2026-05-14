export const channelPluginSurfaceKeys = [
  "actions",
  "setup",
  "status",
  "outbound",
  "messaging",
  "threading",
  "directory",
  "gateway",
] as const;

export type ChannelPluginSurface = (typeof channelPluginSurfaceKeys)[number];

export const sessionBindingContractChannelIds: readonly string[] = [];

export type SessionBindingContractChannelId = string;
