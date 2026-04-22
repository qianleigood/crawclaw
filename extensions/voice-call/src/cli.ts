import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { format } from "node:util";
import type { Command } from "commander";
import { sleep } from "../api.js";
import type { VoiceCallConfig } from "./config.js";
import type { VoiceCallRuntime } from "./runtime.js";
import { resolveUserPath } from "./utils.js";
import {
  cleanupTailscaleExposureRoute,
  getTailscaleSelfInfo,
  setupTailscaleExposureRoute,
} from "./webhook/tailscale.js";

type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

function writeStdoutLine(...values: unknown[]): void {
  process.stdout.write(`${format(...values)}\n`);
}

function writeStdoutJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

type VoiceCallCliLocale = "en" | "zh-CN";

function voiceCallCliText(locale: VoiceCallCliLocale | undefined, en: string, zhCN: string) {
  return locale === "zh-CN" ? zhCN : en;
}

function resolveMode(input: string): "off" | "serve" | "funnel" {
  const raw = input.trim().toLowerCase();
  if (raw === "serve" || raw === "off") {
    return raw;
  }
  return "funnel";
}

function resolveDefaultStorePath(config: VoiceCallConfig): string {
  const preferred = path.join(os.homedir(), ".crawclaw", "voice-calls");
  const resolvedPreferred = resolveUserPath(preferred);
  const existing =
    [resolvedPreferred].find((dir) => {
      try {
        return fs.existsSync(path.join(dir, "calls.jsonl")) || fs.existsSync(dir);
      } catch {
        return false;
      }
    }) ?? resolvedPreferred;
  const base = config.store?.trim() ? resolveUserPath(config.store) : existing;
  return path.join(base, "calls.jsonl");
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function summarizeSeries(values: number[]): {
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
} {
  if (values.length === 0) {
    return { count: 0, minMs: 0, maxMs: 0, avgMs: 0, p50Ms: 0, p95Ms: 0 };
  }

  const minMs = values.reduce(
    (min, value) => (value < min ? value : min),
    Number.POSITIVE_INFINITY,
  );
  const maxMs = values.reduce(
    (max, value) => (value > max ? value : max),
    Number.NEGATIVE_INFINITY,
  );
  const avgMs = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    minMs,
    maxMs,
    avgMs,
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
  };
}

function resolveCallMode(mode?: string): "notify" | "conversation" | undefined {
  return mode === "notify" || mode === "conversation" ? mode : undefined;
}

async function initiateCallAndPrintId(params: {
  runtime: VoiceCallRuntime;
  to: string;
  message?: string;
  mode?: string;
}) {
  const result = await params.runtime.manager.initiateCall(params.to, undefined, {
    message: params.message,
    mode: resolveCallMode(params.mode),
  });
  if (!result.success) {
    throw new Error(result.error || "initiate failed");
  }
  writeStdoutJson({ callId: result.callId });
}

export function registerVoiceCallCli(params: {
  program: Command;
  config: VoiceCallConfig;
  ensureRuntime: () => Promise<VoiceCallRuntime>;
  logger: Logger;
  locale?: VoiceCallCliLocale;
}) {
  const { program, config, ensureRuntime, logger } = params;
  const text = (en: string, zhCN: string) => voiceCallCliText(params.locale, en, zhCN);
  const root = program
    .command("voicecall")
    .description(text("Voice call utilities", "语音通话工具"))
    .addHelpText(
      "after",
      () => `\n${text("Docs:", "文档：")} https://docs.crawclaw.ai/cli/voicecall\n`,
    );

  root
    .command("call")
    .description(text("Initiate an outbound voice call", "发起外呼语音通话"))
    .requiredOption(
      "-m, --message <text>",
      text("Message to speak when call connects", "接通后要朗读的消息"),
    )
    .option(
      "-t, --to <phone>",
      text(
        "Phone number to call (E.164 format, uses config toNumber if not set)",
        "要呼叫的电话号码（E.164 格式；未设置时使用配置中的 toNumber）",
      ),
    )
    .option(
      "--mode <mode>",
      text(
        "Call mode: notify (hangup after message) or conversation (stay open)",
        "通话模式：notify（朗读后挂断）或 conversation（保持通话）",
      ),
      "conversation",
    )
    .action(async (options: { message: string; to?: string; mode?: string }) => {
      const rt = await ensureRuntime();
      const to = options.to ?? rt.config.toNumber;
      if (!to) {
        throw new Error("Missing --to and no toNumber configured");
      }
      await initiateCallAndPrintId({
        runtime: rt,
        to,
        message: options.message,
        mode: options.mode,
      });
    });

  root
    .command("start")
    .description(text("Alias for voicecall call", "voicecall call 的别名"))
    .requiredOption("--to <phone>", text("Phone number to call", "要呼叫的电话号码"))
    .option("--message <text>", text("Message to speak when call connects", "接通后要朗读的消息"))
    .option(
      "--mode <mode>",
      text(
        "Call mode: notify (hangup after message) or conversation (stay open)",
        "通话模式：notify（朗读后挂断）或 conversation（保持通话）",
      ),
      "conversation",
    )
    .action(async (options: { to: string; message?: string; mode?: string }) => {
      const rt = await ensureRuntime();
      await initiateCallAndPrintId({
        runtime: rt,
        to: options.to,
        message: options.message,
        mode: options.mode,
      });
    });

  root
    .command("continue")
    .description(text("Speak a message and wait for a response", "朗读消息并等待回应"))
    .requiredOption("--call-id <id>", text("Call ID", "通话 ID"))
    .requiredOption("--message <text>", text("Message to speak", "要朗读的消息"))
    .action(async (options: { callId: string; message: string }) => {
      const rt = await ensureRuntime();
      const result = await rt.manager.continueCall(options.callId, options.message);
      if (!result.success) {
        throw new Error(result.error || "continue failed");
      }
      writeStdoutJson(result);
    });

  root
    .command("speak")
    .description(text("Speak a message without waiting for response", "朗读消息但不等待回应"))
    .requiredOption("--call-id <id>", text("Call ID", "通话 ID"))
    .requiredOption("--message <text>", text("Message to speak", "要朗读的消息"))
    .action(async (options: { callId: string; message: string }) => {
      const rt = await ensureRuntime();
      const result = await rt.manager.speak(options.callId, options.message);
      if (!result.success) {
        throw new Error(result.error || "speak failed");
      }
      writeStdoutJson(result);
    });

  root
    .command("end")
    .description(text("Hang up an active call", "挂断进行中的通话"))
    .requiredOption("--call-id <id>", text("Call ID", "通话 ID"))
    .action(async (options: { callId: string }) => {
      const rt = await ensureRuntime();
      const result = await rt.manager.endCall(options.callId);
      if (!result.success) {
        throw new Error(result.error || "end failed");
      }
      writeStdoutJson(result);
    });

  root
    .command("status")
    .description(text("Show call status", "显示通话状态"))
    .requiredOption("--call-id <id>", text("Call ID", "通话 ID"))
    .action(async (options: { callId: string }) => {
      const rt = await ensureRuntime();
      const call = rt.manager.getCall(options.callId);
      writeStdoutJson(call ?? { found: false });
    });

  root
    .command("tail")
    .description(
      text(
        "Tail voice-call JSONL logs (prints new lines; useful during provider tests)",
        "跟随语音通话 JSONL 日志（打印新增行，便于 provider 测试）",
      ),
    )
    .option(
      "--file <path>",
      text("Path to calls.jsonl", "calls.jsonl 路径"),
      resolveDefaultStorePath(config),
    )
    .option("--since <n>", text("Print last N lines first", "先打印最后 N 行"), "25")
    .option("--poll <ms>", text("Poll interval in ms", "轮询间隔，单位毫秒"), "250")
    .action(async (options: { file: string; since?: string; poll?: string }) => {
      const file = options.file;
      const since = Math.max(0, Number(options.since ?? 0));
      const pollMs = Math.max(50, Number(options.poll ?? 250));

      if (!fs.existsSync(file)) {
        logger.error(`No log file at ${file}`);
        process.exit(1);
      }

      const initial = fs.readFileSync(file, "utf8");
      const lines = initial.split("\n").filter(Boolean);
      for (const line of lines.slice(Math.max(0, lines.length - since))) {
        writeStdoutLine(line);
      }

      let offset = Buffer.byteLength(initial, "utf8");

      for (;;) {
        try {
          const stat = fs.statSync(file);
          if (stat.size < offset) {
            offset = 0;
          }
          if (stat.size > offset) {
            const fd = fs.openSync(file, "r");
            try {
              const buf = Buffer.alloc(stat.size - offset);
              fs.readSync(fd, buf, 0, buf.length, offset);
              offset = stat.size;
              const text = buf.toString("utf8");
              for (const line of text.split("\n").filter(Boolean)) {
                writeStdoutLine(line);
              }
            } finally {
              fs.closeSync(fd);
            }
          }
        } catch {
          // ignore and retry
        }
        await sleep(pollMs);
      }
    });

  root
    .command("latency")
    .description(
      text(
        "Summarize turn latency metrics from voice-call JSONL logs",
        "汇总语音通话 JSONL 日志中的 turn 延迟指标",
      ),
    )
    .option(
      "--file <path>",
      text("Path to calls.jsonl", "calls.jsonl 路径"),
      resolveDefaultStorePath(config),
    )
    .option("--last <n>", text("Analyze last N records", "分析最后 N 条记录"), "200")
    .action(async (options: { file: string; last?: string }) => {
      const file = options.file;
      const last = Math.max(1, Number(options.last ?? 200));

      if (!fs.existsSync(file)) {
        throw new Error("No log file at " + file);
      }

      const content = fs.readFileSync(file, "utf8");
      const lines = content.split("\n").filter(Boolean).slice(-last);

      const turnLatencyMs: number[] = [];
      const listenWaitMs: number[] = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as {
            metadata?: { lastTurnLatencyMs?: unknown; lastTurnListenWaitMs?: unknown };
          };
          const latency = parsed.metadata?.lastTurnLatencyMs;
          const listenWait = parsed.metadata?.lastTurnListenWaitMs;
          if (typeof latency === "number" && Number.isFinite(latency)) {
            turnLatencyMs.push(latency);
          }
          if (typeof listenWait === "number" && Number.isFinite(listenWait)) {
            listenWaitMs.push(listenWait);
          }
        } catch {
          // ignore malformed JSON lines
        }
      }

      writeStdoutJson({
        recordsScanned: lines.length,
        turnLatency: summarizeSeries(turnLatencyMs),
        listenWait: summarizeSeries(listenWaitMs),
      });
    });

  root
    .command("expose")
    .description(
      text(
        "Enable/disable Tailscale serve/funnel for the webhook",
        "为 webhook 启用或停用 Tailscale serve/funnel",
      ),
    )
    .option(
      "--mode <mode>",
      text("off | serve (tailnet) | funnel (public)", "off | serve（tailnet）| funnel（公网）"),
      "funnel",
    )
    .option(
      "--path <path>",
      text(
        "Tailscale path to expose (recommend matching serve.path)",
        "要暴露的 Tailscale 路径（建议与 serve.path 一致）",
      ),
    )
    .option("--port <port>", text("Local webhook port", "本地 webhook 端口"))
    .option("--serve-path <path>", text("Local webhook path", "本地 webhook 路径"))
    .action(
      async (options: { mode?: string; port?: string; path?: string; servePath?: string }) => {
        const mode = resolveMode(options.mode ?? "funnel");
        const servePort = Number(options.port ?? config.serve.port ?? 3334);
        const servePath = String(options.servePath ?? config.serve.path ?? "/voice/webhook");
        const tsPath = String(options.path ?? config.tailscale?.path ?? servePath);

        const localUrl = `http://127.0.0.1:${servePort}`;

        if (mode === "off") {
          await cleanupTailscaleExposureRoute({ mode: "serve", path: tsPath });
          await cleanupTailscaleExposureRoute({ mode: "funnel", path: tsPath });
          writeStdoutJson({ ok: true, mode: "off", path: tsPath });
          return;
        }

        const publicUrl = await setupTailscaleExposureRoute({
          mode,
          path: tsPath,
          localUrl,
        });

        const tsInfo = publicUrl ? null : await getTailscaleSelfInfo();
        const enableUrl = tsInfo?.nodeId
          ? `https://login.tailscale.com/f/${mode}?node=${tsInfo.nodeId}`
          : null;

        writeStdoutJson({
          ok: Boolean(publicUrl),
          mode,
          path: tsPath,
          localUrl,
          publicUrl,
          hint: publicUrl
            ? undefined
            : {
                note: "Tailscale serve/funnel may be disabled on this tailnet (or require admin enable).",
                enableUrl,
              },
        });
      },
    );
}
