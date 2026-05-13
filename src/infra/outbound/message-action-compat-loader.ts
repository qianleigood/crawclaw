import type { TsChannelMessageActionCompatInput } from "./message-action-compat.js";

type MessageActionCompatModule = typeof import("./message-action-compat.js");

let compatModulePromise: Promise<MessageActionCompatModule> | null = null;

async function loadMessageActionCompat(): Promise<MessageActionCompatModule> {
  compatModulePromise ??= import("./message-action-compat.js");
  return await compatModulePromise;
}

export async function runTsChannelMessageActionCompat(ctx: TsChannelMessageActionCompatInput) {
  const compat = await loadMessageActionCompat();
  return await compat.runTsChannelMessageActionCompat(ctx);
}
