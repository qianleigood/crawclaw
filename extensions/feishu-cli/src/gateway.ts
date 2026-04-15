import type { GatewayRequestHandlerOptions } from "../../../src/gateway/server-methods/types.js";
import type { FeishuCliPluginConfig } from "./config.js";
import { getFeishuCliStatus } from "./lark-cli.js";

export async function handleFeishuCliStatusGatewayRequest(
  opts: GatewayRequestHandlerOptions & {
    pluginConfig: FeishuCliPluginConfig;
  },
): Promise<void> {
  const verify = opts.params.verify === true;
  const status = await getFeishuCliStatus({
    config: opts.pluginConfig,
    verify,
  });
  opts.respond(true, status);
}
