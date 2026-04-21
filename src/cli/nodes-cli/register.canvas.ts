import fs from "node:fs/promises";
import type { Command } from "commander";
import { defaultRuntime } from "../../runtime.js";
import { shortenHomePath } from "../../utils.js";
import { writeBase64ToFile } from "../nodes-camera.js";
import { canvasSnapshotTempPath, parseCanvasSnapshotPayload } from "../nodes-canvas.js";
import { parseTimeoutMs } from "../parse-timeout.js";
import { buildA2UITextJsonl, validateA2UIJsonl } from "./a2ui-jsonl.js";
import { getNodesTheme, runNodesCommand } from "./cli-utils.js";
import {
  buildNodeInvokeParams,
  callGatewayCli,
  getCommandTranslator,
  nodesCallOpts,
  resolveNodeId,
} from "./rpc.js";
import type { NodesRpcOpts } from "./types.js";

async function invokeCanvas(opts: NodesRpcOpts, command: string, params?: Record<string, unknown>) {
  const nodeId = await resolveNodeId(opts, opts.node ?? "");
  const timeoutMs = parseTimeoutMs(opts.invokeTimeout);
  return await callGatewayCli(
    "node.invoke",
    opts,
    buildNodeInvokeParams({
      nodeId,
      command,
      params,
      timeoutMs: typeof timeoutMs === "number" ? timeoutMs : undefined,
    }),
  );
}

export function registerNodesCanvasCommands(nodes: Command) {
  const t = getCommandTranslator(nodes);
  const canvas = nodes.command("canvas").description(t("command.nodes.canvas.description"));

  nodesCallOpts(
    canvas
      .command("snapshot")
      .description(t("command.nodes.canvas.snapshot.description"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--format <png|jpg|jpeg>", t("command.nodes.canvas.option.format"), "jpg")
      .option("--max-width <px>", t("command.nodes.option.maxWidth"))
      .option("--quality <0-1>", t("command.nodes.option.jpegQuality"))
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeoutDefault20000"), "20000")
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("canvas snapshot", async () => {
          const formatOpt = (opts.format ?? "jpg").trim().toLowerCase();
          const formatForParams =
            formatOpt === "jpg" ? "jpeg" : formatOpt === "jpeg" ? "jpeg" : "png";
          if (formatForParams !== "png" && formatForParams !== "jpeg") {
            throw new Error(`invalid format: ${opts.format} (expected png|jpg|jpeg)`);
          }

          const maxWidth = opts.maxWidth ? Number.parseInt(opts.maxWidth, 10) : undefined;
          const quality = opts.quality ? Number.parseFloat(opts.quality) : undefined;
          const raw = await invokeCanvas(opts, "canvas.snapshot", {
            format: formatForParams,
            maxWidth: Number.isFinite(maxWidth) ? maxWidth : undefined,
            quality: Number.isFinite(quality) ? quality : undefined,
          });
          const res = typeof raw === "object" && raw !== null ? (raw as { payload?: unknown }) : {};
          const payload = parseCanvasSnapshotPayload(res.payload);
          const filePath = canvasSnapshotTempPath({
            ext: payload.format === "jpeg" ? "jpg" : payload.format,
          });
          await writeBase64ToFile(filePath, payload.base64);

          if (opts.json) {
            defaultRuntime.writeJson({ file: { path: filePath, format: payload.format } });
            return;
          }
          defaultRuntime.log(`MEDIA:${shortenHomePath(filePath)}`);
        });
      }),
    { timeoutMs: 60_000 },
  );

  nodesCallOpts(
    canvas
      .command("present")
      .description(t("command.nodes.canvas.present.description"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--target <urlOrPath>", t("command.nodes.canvas.option.target"))
      .option("--x <px>", t("command.nodes.canvas.option.x"))
      .option("--y <px>", t("command.nodes.canvas.option.y"))
      .option("--width <px>", t("command.nodes.canvas.option.width"))
      .option("--height <px>", t("command.nodes.canvas.option.height"))
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeout"))
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("canvas present", async () => {
          const placement = {
            x: opts.x ? Number.parseFloat(opts.x) : undefined,
            y: opts.y ? Number.parseFloat(opts.y) : undefined,
            width: opts.width ? Number.parseFloat(opts.width) : undefined,
            height: opts.height ? Number.parseFloat(opts.height) : undefined,
          };
          const params: Record<string, unknown> = {};
          if (opts.target) {
            params.url = opts.target;
          }
          if (
            Number.isFinite(placement.x) ||
            Number.isFinite(placement.y) ||
            Number.isFinite(placement.width) ||
            Number.isFinite(placement.height)
          ) {
            params.placement = placement;
          }
          await invokeCanvas(opts, "canvas.present", params);
          if (!opts.json) {
            const { ok } = getNodesTheme();
            defaultRuntime.log(ok("canvas present ok"));
          }
        });
      }),
  );

  nodesCallOpts(
    canvas
      .command("hide")
      .description(t("command.nodes.canvas.hide.description"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeout"))
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("canvas hide", async () => {
          await invokeCanvas(opts, "canvas.hide", undefined);
          if (!opts.json) {
            const { ok } = getNodesTheme();
            defaultRuntime.log(ok("canvas hide ok"));
          }
        });
      }),
  );

  nodesCallOpts(
    canvas
      .command("navigate")
      .description(t("command.nodes.canvas.navigate.description"))
      .argument("<url>", t("command.nodes.canvas.argument.url"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeout"))
      .action(async (url: string, opts: NodesRpcOpts) => {
        await runNodesCommand("canvas navigate", async () => {
          await invokeCanvas(opts, "canvas.navigate", { url });
          if (!opts.json) {
            const { ok } = getNodesTheme();
            defaultRuntime.log(ok("canvas navigate ok"));
          }
        });
      }),
  );

  nodesCallOpts(
    canvas
      .command("eval")
      .description(t("command.nodes.canvas.eval.description"))
      .argument("[js]", t("command.nodes.canvas.eval.argument.js"))
      .option("--js <code>", t("command.nodes.canvas.eval.option.js"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeout"))
      .action(async (jsArg: string | undefined, opts: NodesRpcOpts) => {
        await runNodesCommand("canvas eval", async () => {
          const js = opts.js ?? jsArg;
          if (!js) {
            throw new Error("missing --js or <js>");
          }
          const raw = await invokeCanvas(opts, "canvas.eval", {
            javaScript: js,
          });
          if (opts.json) {
            defaultRuntime.writeJson(raw);
            return;
          }
          const payload =
            typeof raw === "object" && raw !== null
              ? (raw as { payload?: { result?: string } }).payload
              : undefined;
          if (payload?.result) {
            defaultRuntime.log(payload.result);
          } else {
            const { ok } = getNodesTheme();
            defaultRuntime.log(ok("canvas eval ok"));
          }
        });
      }),
  );

  const a2ui = canvas.command("a2ui").description(t("command.nodes.canvas.a2ui.description"));

  nodesCallOpts(
    a2ui
      .command("push")
      .description(t("command.nodes.canvas.a2ui.push.description"))
      .option("--jsonl <path>", t("command.nodes.canvas.a2ui.option.jsonl"))
      .option("--text <text>", t("command.nodes.canvas.a2ui.option.text"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeout"))
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("canvas a2ui push", async () => {
          const hasJsonl = Boolean(opts.jsonl);
          const hasText = typeof opts.text === "string";
          if (hasJsonl === hasText) {
            throw new Error("provide exactly one of --jsonl or --text");
          }

          const jsonl = hasText
            ? buildA2UITextJsonl(opts.text ?? "")
            : await fs.readFile(opts.jsonl ?? "", "utf8");
          const { version, messageCount } = validateA2UIJsonl(jsonl);
          if (version === "v0.9") {
            throw new Error(
              "Detected A2UI v0.9 JSONL (createSurface). CrawClaw currently supports v0.8 only.",
            );
          }
          await invokeCanvas(opts, "canvas.a2ui.pushJSONL", { jsonl });
          if (!opts.json) {
            const { ok } = getNodesTheme();
            defaultRuntime.log(
              ok(
                `canvas a2ui push ok (v0.8, ${messageCount} message${messageCount === 1 ? "" : "s"})`,
              ),
            );
          }
        });
      }),
  );

  nodesCallOpts(
    a2ui
      .command("reset")
      .description(t("command.nodes.canvas.a2ui.reset.description"))
      .requiredOption("--node <idOrNameOrIp>", t("command.nodes.option.node"))
      .option("--invoke-timeout <ms>", t("command.nodes.option.invokeTimeout"))
      .action(async (opts: NodesRpcOpts) => {
        await runNodesCommand("canvas a2ui reset", async () => {
          await invokeCanvas(opts, "canvas.a2ui.reset", undefined);
          if (!opts.json) {
            const { ok } = getNodesTheme();
            defaultRuntime.log(ok("canvas a2ui reset ok"));
          }
        });
      }),
  );
}
