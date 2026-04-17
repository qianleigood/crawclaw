type CommandSurfaceParams = {
  ctx: {
    OriginatingChannel?: string;
    Surface?: string;
    Provider?: string;
    AccountId?: string;
  };
  command: {
    channel?: string;
  };
};

type ChannelAccountParams = {
  ctx: {
    AccountId?: string;
  };
};

export function resolveCommandSurfaceChannel(params: CommandSurfaceParams): string {
  const channel =
    params.ctx.OriginatingChannel ??
    params.command.channel ??
    params.ctx.Surface ??
    params.ctx.Provider;
  return (channel ?? "").trim().toLowerCase();
}

export function isDiscordSurface(params: CommandSurfaceParams): boolean {
  return resolveCommandSurfaceChannel(params) === "discord";
}

export function isTelegramSurface(params: CommandSurfaceParams): boolean {
  return resolveCommandSurfaceChannel(params) === "telegram";
}

export function isMatrixSurface(params: CommandSurfaceParams): boolean {
  return resolveCommandSurfaceChannel(params) === "matrix";
}

export function resolveChannelAccountId(params: ChannelAccountParams): string {
  const accountId = typeof params.ctx.AccountId === "string" ? params.ctx.AccountId.trim() : "";
  return accountId || "default";
}

export function resolveDiscordAccountId(params: ChannelAccountParams): string {
  return resolveChannelAccountId(params);
}
