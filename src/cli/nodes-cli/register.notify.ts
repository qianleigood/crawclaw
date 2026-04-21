import type { Command } from "commander";
import { randomIdempotencyKey } from "../../gateway/call.js";
import { defaultRuntime } from "../../runtime.js";
import { getNodesTheme, runNodesCommand } from "./cli-utils.js";
import { callGatewayCli, getCommandTranslator, nodesCallOpts, resolveNodeId } from "./rpc.js";
import type { NodesRpcOpts } from "./types.js";

export function registerNodesNotifyCommand(nodes: Command) {
  const t = getCommandTranslator(nodes);
  nodesCallOpts(
    nodes
      .command("notify")
      .description(t("command.nodes.notify.description"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--title <text>", t("command.nodes.notify.option.title"))
      .option("--body <text>", t("command.nodes.notify.option.body"))
      .option("--sound <name>", t("command.nodes.notify.option.sound"))
      .option(
        "--priority <passive|active|timeSensitive>",
        t("command.nodes.notify.option.priority"),
      )
      .option(
        "--delivery <system|overlay|auto>",
        t("command.nodes.notify.option.delivery"),
        "system",
      )
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeoutDefault15000"), "15000")
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("notify", async () => {
          const nodeId = await resolveNodeId(opts, opts.node ?? "");
          const title = (opts.title ?? "").trim();
          const body = (opts.body ?? "").trim();
          if (!title && !body) {
            throw new Error("missing --title or --body");
          }
          const invokeTimeout = opts.invokeTimeout
            ? Number.parseInt(opts.invokeTimeout, 10)
            : undefined;
          const invokeParams: Record<string, unknown> = {
            nodeId,
            command: "system.notify",
            params: {
              title,
              body,
              sound: opts.sound,
              priority: opts.priority,
              delivery: opts.delivery,
            },
            idempotencyKey: opts.idempotencyKey ?? randomIdempotencyKey(),
          };
          if (typeof invokeTimeout === "number" && Number.isFinite(invokeTimeout)) {
            invokeParams.timeoutMs = invokeTimeout;
          }

          const result = await callGatewayCli("node.invoke", opts, invokeParams);
          if (opts.json) {
            defaultRuntime.writeJson(result);
            return;
          }
          const { ok } = getNodesTheme();
          defaultRuntime.log(ok("notify ok"));
        });
      }),
  );
}
