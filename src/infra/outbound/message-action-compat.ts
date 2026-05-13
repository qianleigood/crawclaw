import { dispatchChannelMessageAction } from "../../channels/plugins/message-action-dispatch.js";

export type TsChannelMessageActionCompatInput = Parameters<typeof dispatchChannelMessageAction>[0];

export async function runTsChannelMessageActionCompat(ctx: TsChannelMessageActionCompatInput) {
  return await dispatchChannelMessageAction(ctx);
}
