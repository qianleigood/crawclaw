import { defineChannelPluginEntry } from "crawclaw/plugin-sdk/core";
import { feishuPlugin } from "./src/channel.js";
import { setFeishuRuntime } from "./src/runtime.js";

export { feishuPlugin } from "./src/channel.js";
export { setFeishuRuntime } from "./src/runtime.js";
export {
  sendMessageFeishu,
  sendCardFeishu,
  updateCardFeishu,
  editMessageFeishu,
  getMessageFeishu,
} from "./src/send.js";
export {
  uploadImageFeishu,
  uploadFileFeishu,
  sendImageFeishu,
  sendFileFeishu,
  sendMediaFeishu,
} from "./src/media.js";
export { probeFeishu } from "./src/probe.js";
export {
  addReactionFeishu,
  removeReactionFeishu,
  listReactionsFeishu,
  FeishuEmoji,
} from "./src/reactions.js";
export {
  extractMentionTargets,
  extractMessageBody,
  isMentionForwardRequest,
  formatMentionForText,
  formatMentionForCard,
  formatMentionAllForText,
  formatMentionAllForCard,
  buildMentionedMessage,
  buildMentionedCardContent,
  type MentionTarget,
} from "./src/mention.js";

type MonitorFeishuProvider = typeof import("./src/monitor.js").monitorFeishuProvider;
type FeishuFullRuntimeModule = typeof import("./full.runtime.js");

let feishuMonitorPromise: Promise<typeof import("./src/monitor.js")> | null = null;
let feishuFullRuntimePromise: Promise<FeishuFullRuntimeModule> | null = null;

function loadFeishuMonitorModule() {
  feishuMonitorPromise ??= import("./src/monitor.js");
  return feishuMonitorPromise;
}

function loadFeishuFullRuntimeModule() {
  feishuFullRuntimePromise ??= import("./full.runtime.js");
  return feishuFullRuntimePromise;
}

export async function monitorFeishuProvider(
  ...args: Parameters<MonitorFeishuProvider>
): ReturnType<MonitorFeishuProvider> {
  const { monitorFeishuProvider } = await loadFeishuMonitorModule();
  return await monitorFeishuProvider(...args);
}

export default defineChannelPluginEntry({
  id: "feishu",
  name: "Feishu",
  description: "Feishu/Lark channel plugin",
  plugin: feishuPlugin,
  setRuntime: setFeishuRuntime,
  registerFull(api) {
    return loadFeishuFullRuntimeModule().then(({ registerFeishuFull }) => {
      registerFeishuFull(api);
    });
  },
});
