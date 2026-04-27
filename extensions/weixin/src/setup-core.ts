import { createPatchedAccountSetupAdapter } from "crawclaw/plugin-sdk/setup";

export const weixinSetupAdapter = createPatchedAccountSetupAdapter({
  channelKey: "weixin",
  ensureChannelEnabled: true,
  ensureAccountEnabled: true,
  buildPatch: () => ({}),
});
