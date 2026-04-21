import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { shortenHomePath } from "../../utils.js";
import {
  parseScreenRecordPayload,
  screenRecordTempPath,
  writeScreenRecordToFile,
} from "../nodes-screen.js";
import { parseDurationMs } from "../parse-duration.js";
import { runNodesCommand } from "./cli-utils.js";
import {
  buildNodeInvokeParams,
  callGatewayCli,
  getCommandTranslator,
  nodesCallOpts,
  resolveNodeId,
} from "./rpc.js";
import type { NodesRpcOpts } from "./types.js";

export function registerNodesScreenCommands(nodes: Command) {
  const t = getCommandTranslator(nodes);
  const screen = nodes.command("screen").description(t("command.nodes.screen.description"));

  nodesCallOpts(
    screen
      .command("record")
      .description(t("command.nodes.screen.record.description"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--screen <index>", t("command.nodes.screen.option.screen"), "0")
      .option("--duration <ms|10s>", t("command.nodes.screen.option.duration"), "10000")
      .option("--fps <fps>", t("command.nodes.screen.option.fps"), "10")
      .option("--no-audio", t("command.nodes.screen.option.noAudio"))
      .option("--out <path>", t("command.nodes.screen.option.out"))
      .option(
        "--invoke-timeout <ms>",
        t("command.nodes.option.invokeTimeoutDefault120000"),
        "120000",
      )
      .action(async (opts: NodesRpcOpts & { out?: string }) => {
        await runNodesCommand("screen record", async () => {
          const nodeId = await resolveNodeId(opts, opts.node ?? "");
          const durationMs = parseDurationMs(opts.duration ?? "");
          const screenIndex = Number.parseInt(opts.screen ?? "0", 10);
          const fps = Number.parseFloat(opts.fps ?? "10");
          const timeoutMs = opts.invokeTimeout
            ? Number.parseInt(opts.invokeTimeout, 10)
            : undefined;

          const invokeParams = buildNodeInvokeParams({
            nodeId,
            command: "screen.record",
            params: {
              durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
              screenIndex: Number.isFinite(screenIndex) ? screenIndex : undefined,
              fps: Number.isFinite(fps) ? fps : undefined,
              format: "mp4",
              includeAudio: opts.audio !== false,
            },
            timeoutMs,
          });

          const raw = await callGatewayCli("node.invoke", opts, invokeParams);
          const res = typeof raw === "object" && raw !== null ? (raw as { payload?: unknown }) : {};
          const parsed = parseScreenRecordPayload(res.payload);
          const filePath = opts.out ?? screenRecordTempPath({ ext: parsed.format || "mp4" });
          const written = await writeScreenRecordToFile(filePath, parsed.base64);

          if (opts.json) {
            defaultRuntime.writeJson({
              file: {
                path: written.path,
                durationMs: parsed.durationMs,
                fps: parsed.fps,
                screenIndex: parsed.screenIndex,
                hasAudio: parsed.hasAudio,
              },
            });
            return;
          }
          defaultRuntime.log(`MEDIA:${shortenHomePath(written.path)}`);
        });
      }),
    { timeoutMs: 180_000 },
  );
}
