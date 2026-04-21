import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { getTerminalTableWidth } from "../../terminal/table.js";
import { getNodesTheme, runNodesCommand } from "./cli-utils.js";
import { parsePairingList } from "./format.js";
import { renderPendingPairingRequestsTable } from "./pairing-render.js";
import { callGatewayCli, getCommandTranslator, nodesCallOpts, resolveNodeId } from "./rpc.js";
import type { NodesRpcOpts } from "./types.js";

export function registerNodesPairingCommands(nodes: Command) {
  const t = getCommandTranslator(nodes);
  nodesCallOpts(
    nodes
      .command("pending")
      .description(t("command.nodes.pairing.pending.description"))
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("pending", async () => {
          const result = await callGatewayCli("node.pair.list", opts, {});
          const { pending } = parsePairingList(result);
          if (opts.json) {
            defaultRuntime.writeJson(pending);
            return;
          }
          if (pending.length === 0) {
            const { muted } = getNodesTheme();
            defaultRuntime.log(muted("No pending pairing requests."));
            return;
          }
          const { heading, warn, muted } = getNodesTheme();
          const tableWidth = getTerminalTableWidth();
          const now = Date.now();
          const rendered = renderPendingPairingRequestsTable({
            pending,
            now,
            tableWidth,
            theme: { heading, warn, muted },
          });
          defaultRuntime.log(rendered.heading);
          defaultRuntime.log(rendered.table);
        });
      }),
  );

  nodesCallOpts(
    nodes
      .command("approve")
      .description(t("command.nodes.pairing.approve.description"))
      .argument("<requestId>", t("command.nodes.pairing.argument.requestId"))
      .action(async (requestId: string, opts: NodesRpcOpts) => {
        await runNodesCommand("approve", async () => {
          const result = await callGatewayCli("node.pair.approve", opts, {
            requestId,
          });
          defaultRuntime.writeJson(result);
        });
      }),
  );

  nodesCallOpts(
    nodes
      .command("reject")
      .description(t("command.nodes.pairing.reject.description"))
      .argument("<requestId>", t("command.nodes.pairing.argument.requestId"))
      .action(async (requestId: string, opts: NodesRpcOpts) => {
        await runNodesCommand("reject", async () => {
          const result = await callGatewayCli("node.pair.reject", opts, {
            requestId,
          });
          defaultRuntime.writeJson(result);
        });
      }),
  );

  nodesCallOpts(
    nodes
      .command("rename")
      .description(t("command.nodes.pairing.rename.description"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .requiredOption("--name <displayName>", t("command.nodes.pairing.rename.option.name"))
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("rename", async () => {
          const nodeId = await resolveNodeId(opts, opts.node ?? "");
          const name = (opts.name ?? "").trim();
          if (!nodeId || !name) {
            defaultRuntime.error("--node and --name required");
            defaultRuntime.exit(1);
            return;
          }
          const result = await callGatewayCli("node.rename", opts, {
            nodeId,
            displayName: name,
          });
          if (opts.json) {
            defaultRuntime.writeJson(result);
            return;
          }
          const { ok } = getNodesTheme();
          defaultRuntime.log(ok(`node rename ok: ${nodeId} -> ${name}`));
        });
      }),
  );
}
