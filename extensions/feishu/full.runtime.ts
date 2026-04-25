import type { CrawClawPluginApi } from "crawclaw/plugin-sdk/core";
import { registerFeishuBitableTools } from "./src/bitable.js";
import { registerFeishuChatTools } from "./src/chat.js";
import { registerFeishuDocTools } from "./src/docx.js";
import { registerFeishuDriveTools } from "./src/drive.js";
import { registerFeishuPermTools } from "./src/perm.js";
import { registerFeishuSubagentHooks } from "./src/subagent-hooks.js";
import { registerFeishuWikiTools } from "./src/wiki.js";

export function registerFeishuFull(api: CrawClawPluginApi): void {
  registerFeishuSubagentHooks(api);
  registerFeishuDocTools(api);
  registerFeishuChatTools(api);
  registerFeishuWikiTools(api);
  registerFeishuDriveTools(api);
  registerFeishuPermTools(api);
  registerFeishuBitableTools(api);
}
