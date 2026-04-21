import type { Command } from "commander";
import { randomIdempotencyKey } from "../../gateway/call.js";
import { defaultRuntime } from "../../runtime.js";
import { getNodesTheme, runNodesCommand } from "./cli-utils.js";
import { callGatewayCli, getCommandTranslator, nodesCallOpts, resolveNodeId } from "./rpc.js";
import type { NodesRpcOpts } from "./types.js";

const BLOCKED_NODE_INVOKE_COMMANDS = new Set(["system.run", "system.run.prepare"]);

export function registerNodesInvokeCommands(nodes: Command) {
  const t = getCommandTranslator(nodes);
  nodesCallOpts(
    nodes
      .command("invoke")
      .description(t("command.nodes.invoke.description"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .requiredOption("--command <command>", t("command.nodes.invoke.option.command"))
      .option("--params <json>", t("command.nodes.invoke.option.params"), "{}")
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeoutDefault15000"), "15000")
      .option("--idempotency-key <key>", t("command.nodes.invoke.option.idempotencyKey"))
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("invoke", async () => {
          const nodeId = await resolveNodeId(opts, opts.node ?? "");
          const command = (opts.command ?? "").trim();
          if (!nodeId || !command) {
            const { error } = getNodesTheme();
            defaultRuntime.error(error("--node and --command required"));
            defaultRuntime.exit(1);
            return;
          }
          if (BLOCKED_NODE_INVOKE_COMMANDS.has(command.toLowerCase())) {
            throw new Error(
              `command "${command}" is reserved for shell execution; use the exec tool with host=node instead`,
            );
          }
          const params = JSON.parse(opts.params ?? "{}") as unknown;
          const timeoutMs = opts.invokeTimeout
            ? Number.parseInt(opts.invokeTimeout, 10)
            : undefined;

          const invokeParams: Record<string, unknown> = {
            nodeId,
            command,
            params,
            idempotencyKey: opts.idempotencyKey ?? randomIdempotencyKey(),
          };
          if (typeof timeoutMs === "number" && Number.isFinite(timeoutMs)) {
            invokeParams.timeoutMs = timeoutMs;
          }

          const result = await callGatewayCli("node.invoke", opts, invokeParams);
          defaultRuntime.writeJson(result);
        });
      }),
    { timeoutMs: 30_000 },
  );
}
