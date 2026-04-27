import {
  createStandardChannelSetupStatus,
  formatDocsLink,
  setSetupChannelEnabled,
  type ChannelSetupWizard,
} from "crawclaw/plugin-sdk/setup";
import { listWeixinAccountIds, resolveWeixinAccount } from "./auth/accounts.js";
import { weixinSetupAdapter } from "./setup-core.js";

const channel = "weixin" as const;

export const weixinSetupWizard: ChannelSetupWizard = {
  channel,
  status: createStandardChannelSetupStatus({
    channelLabel: "Weixin",
    configuredLabel: "linked",
    unconfiguredLabel: "needs QR login",
    configuredHint: "linked",
    unconfiguredHint: "run QR login after setup",
    configuredScore: 1,
    unconfiguredScore: 0,
    includeStatusLine: true,
    resolveConfigured: ({ cfg }) =>
      listWeixinAccountIds(cfg).some(
        (accountId) => resolveWeixinAccount(cfg, accountId).configured,
      ),
  }),
  introNote: {
    title: "Weixin setup",
    lines: [
      "Weixin uses Tencent iLink Bot QR login.",
      "Setup only enables the channel and records the local account slot.",
      "After setup, run QR login to link the bot account.",
      `Docs: ${formatDocsLink("/channels/weixin", "channels/weixin")}`,
    ],
  },
  credentials: [],
  completionNote: {
    title: "Weixin next steps",
    lines: [
      "Next: run `crawclaw channels login --channel weixin` to generate a QR code.",
      "Then scan it in WeChat and wait for the gateway to reconnect.",
      "Verify with `crawclaw channels status --probe`.",
    ],
  },
  disable: (cfg) => setSetupChannelEnabled(cfg, channel, false),
};

export { weixinSetupAdapter };
