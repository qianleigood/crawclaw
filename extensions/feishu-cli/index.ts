import { definePluginEntry, type CrawClawPluginApi } from "crawclaw/plugin-sdk/plugin-entry";
import { registerFeishuCliCli } from "./src/cli.js";
import { feishuCliConfigSchema, parseFeishuCliConfig } from "./src/config.js";
import { handleFeishuCliStatusGatewayRequest } from "./src/gateway.js";
import { registerFeishuCliTools } from "./src/tools.js";

export default definePluginEntry({
  id: "feishu-cli",
  name: "Feishu CLI",
  description: "User-identity Feishu execution via the official lark-cli",
  configSchema: feishuCliConfigSchema,
  register(api: CrawClawPluginApi) {
    const config = parseFeishuCliConfig(api.pluginConfig);

    api.registerCli(
      ({ program, locale }) =>
        registerFeishuCliCli({
          program,
          config,
          logger: api.logger,
          locale,
        }),
      {
        commands: ["feishu-cli"],
        descriptors: [
          {
            name: "feishu-cli",
            description: "Inspect Feishu user-identity tooling via the official lark-cli",
            descriptionZhCN: "通过官方 lark-cli 检查飞书用户身份工具",
            hasSubcommands: true,
          },
        ],
      },
    );

    api.registerGatewayMethod(
      "feishu.cli.status",
      (ctx) => handleFeishuCliStatusGatewayRequest({ ...ctx, pluginConfig: config }),
      {
        scope: "operator.read",
      },
    );

    if (!config.enabled) {
      api.logger.info?.("feishu-cli: disabled in plugin config; skipping user tools");
      return;
    }

    registerFeishuCliTools(api, config);
  },
});
