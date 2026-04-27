import { getHealthSnapshot, type HealthSummary } from "../../commands/health.js";
import type { CrawClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { callGateway } from "../../gateway/call.js";
import { listDevicePairing, summarizeDeviceTokens } from "../../infra/device-pairing.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  readPluginRuntimeManifest,
  resolvePluginRuntimeManifestPath,
  type PluginRuntimeManifest,
} from "../../plugins/plugin-runtimes.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../../utils/message-channel.js";
import { translateSlashCommandText } from "../commands-i18n.js";
import { listSkillCommandsForAgents } from "../skill-commands.js";
import type { CommandHandler, CommandHandlerResult } from "./commands-types.js";

type Reply = NonNullable<CommandHandlerResult["reply"]>;

type SessionSummaryEntry = Pick<SessionEntry, "sessionId" | "updatedAt">;

function tr(cfg: CrawClawConfig | undefined, en: string, zhCN: string): string {
  return translateSlashCommandText(en, cfg, zhCN);
}

function stopWithText(text: string): CommandHandlerResult {
  return { shouldContinue: false, reply: { text } };
}

function replyText(reply: Reply): string {
  return reply.text ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function formatRelativeAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return `${Math.round(hours / 24)}d ago`;
}

function readCommandToken(normalized: string): string | null {
  const match = normalized.trim().match(/^\/([^\s]+)(?:\s|$)/);
  return match?.[1]?.toLowerCase() ?? null;
}

function isQueryCommandToken(token: string): boolean {
  return (
    token === "skills" ||
    token === "sessions" ||
    token === "runtimes" ||
    token === "health" ||
    token === "channels" ||
    token === "nodes" ||
    token === "devices" ||
    token === "memory"
  );
}

export function buildSkillsQueryReply(params: {
  cfg?: CrawClawConfig;
  skillCommands: Array<{ name: string; description: string }>;
}): Reply {
  const { cfg, skillCommands } = params;
  const lines = [`🧰 ${tr(cfg, "Skills", "技能")}`];
  if (skillCommands.length === 0) {
    lines.push(tr(cfg, "No skills are available for this agent.", "此 agent 没有可用技能。"));
  } else {
    for (const skill of skillCommands
      .toSorted((a, b) => a.name.localeCompare(b.name))
      .slice(0, 20)) {
      lines.push(`- /${skill.name} - ${skill.description}`);
    }
  }
  lines.push(
    "",
    tr(
      cfg,
      "Tip: /skills lists commands; /skill <name> [input] runs one.",
      "提示：/skills 列出命令；/skill <name> [input] 运行单个技能。",
    ),
  );
  return { text: lines.join("\n") };
}

export function buildSessionsQueryReply(params: {
  cfg?: CrawClawConfig;
  sessionStore?: Record<string, SessionSummaryEntry>;
  now?: number;
}): Reply {
  const { cfg } = params;
  const now = params.now ?? Date.now();
  const sessions = Object.entries(params.sessionStore ?? {})
    .filter(([key]) => key !== "global" && key !== "unknown")
    .map(([key, entry]) => ({
      key,
      sessionId: entry?.sessionId,
      updatedAt: entry?.updatedAt ?? 0,
    }))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const lines = [
    `💬 ${tr(cfg, "Sessions", "会话")}`,
    tr(cfg, `${sessions.length} active`, `${sessions.length} 个活跃会话`),
  ];
  if (sessions.length === 0) {
    lines.push(tr(cfg, "No sessions found.", "未找到会话。"));
  } else {
    for (const session of sessions.slice(0, 10)) {
      const age = session.updatedAt ? ` · ${formatRelativeAge(now - session.updatedAt)}` : "";
      const id = session.sessionId ? ` · ${session.sessionId}` : "";
      lines.push(`- ${session.key}${id}${age}`);
    }
  }
  lines.push(
    "",
    tr(
      cfg,
      "Tip: /sessions is read-only; use /session idle|max-age for this chat's settings.",
      "提示：/sessions 只读；使用 /session idle|max-age 修改当前聊天设置。",
    ),
  );
  return { text: lines.join("\n") };
}

export function buildRuntimesQueryReply(params: {
  cfg?: CrawClawConfig;
  manifestPath: string;
  manifest: PluginRuntimeManifest;
}): Reply {
  const { cfg, manifest, manifestPath } = params;
  const plugins = manifest.plugins ?? {};
  const lines = [`🧩 ${tr(cfg, "Runtimes", "运行时")}`, manifestPath];
  const entries = Object.entries(plugins).toSorted(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    lines.push(tr(cfg, "No runtime manifest entries found.", "未找到 runtime manifest 条目。"));
  } else {
    for (const [pluginId, entry] of entries) {
      lines.push(`- ${pluginId}: ${entry.state ?? "unknown"}`);
    }
  }
  lines.push(
    "",
    tr(
      cfg,
      "Tip: /runtimes shows installs; use /plugins to inspect or change plugin enablement.",
      "提示：/runtimes 显示安装状态；使用 /plugins 查看或修改插件启用状态。",
    ),
  );
  return { text: lines.join("\n") };
}

function buildHealthReply(summary: HealthSummary, cfg?: CrawClawConfig): Reply {
  const configuredChannels = Object.values(summary.channels).filter(
    (channel) => channel.configured === true,
  ).length;
  return {
    text: [
      `🩺 ${tr(cfg, "Health", "健康")}`,
      tr(cfg, `Gateway: ok (${summary.durationMs}ms)`, `Gateway：正常 (${summary.durationMs}ms)`),
      tr(
        cfg,
        `Agents: ${summary.agents.length} · default ${summary.defaultAgentId}`,
        `Agents：${summary.agents.length} · 默认 ${summary.defaultAgentId}`,
      ),
      tr(cfg, `Sessions: ${summary.sessions.count}`, `会话：${summary.sessions.count}`),
      tr(
        cfg,
        `Channels: ${configuredChannels}/${summary.channelOrder.length} configured`,
        `渠道：${configuredChannels}/${summary.channelOrder.length} 已配置`,
      ),
      "",
      tr(
        cfg,
        "Tip: /channels shows the channel detail view from the same health snapshot.",
        "提示：/channels 会显示同一份 health 快照中的渠道明细。",
      ),
    ].join("\n"),
  };
}

function buildChannelsReply(summary: HealthSummary, cfg?: CrawClawConfig): Reply {
  const lines = [`📡 ${tr(cfg, "Channels", "渠道")}`];
  for (const channelId of summary.channelOrder) {
    const channel = summary.channels[channelId];
    const label = summary.channelLabels[channelId] ?? channelId;
    if (!channel) {
      lines.push(`- ${label}: ${tr(cfg, "not configured", "未配置")}`);
      continue;
    }
    const configured =
      channel.configured === true
        ? tr(cfg, "configured", "已配置")
        : tr(cfg, "not configured", "未配置");
    const accounts = Object.keys(channel.accounts ?? {}).length;
    lines.push(
      `- ${label}: ${configured}${
        accounts > 1 ? ` · ${tr(cfg, `${accounts} accounts`, `${accounts} 个账号`)}` : ""
      }`,
    );
  }
  lines.push(
    "",
    tr(
      cfg,
      "Tip: /channels is the channel detail view for /health.",
      "提示：/channels 是 /health 的渠道明细视图。",
    ),
  );
  return { text: lines.join("\n") };
}

function formatUnknownGatewayPayload(value: unknown): string {
  if (!isRecord(value)) {
    if (value == null) {
      return "";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value, null, 2);
}

async function callGatewayRead(method: string, params?: unknown): Promise<unknown> {
  return await callGateway({
    method,
    params,
    timeoutMs: 5000,
    clientName: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
    mode: GATEWAY_CLIENT_MODES.BACKEND,
  });
}

async function buildNodesReply(cfg?: CrawClawConfig): Promise<Reply> {
  const payload = await callGatewayRead("node.list", {});
  const nodes = isRecord(payload) && Array.isArray(payload.nodes) ? payload.nodes : [];
  const lines = [
    `🖥️ ${tr(cfg, "Nodes", "节点")}`,
    tr(cfg, `${nodes.length} known`, `${nodes.length} 个已知节点`),
  ];
  for (const node of nodes.slice(0, 20)) {
    if (!isRecord(node)) {
      continue;
    }
    const id = typeof node.nodeId === "string" ? node.nodeId : "unknown";
    const name = typeof node.displayName === "string" ? ` · ${node.displayName}` : "";
    const connected =
      node.connected === true ? tr(cfg, "connected", "在线") : tr(cfg, "offline", "离线");
    lines.push(`- ${id}${name} · ${connected}`);
  }
  lines.push(
    "",
    tr(
      cfg,
      "Tip: /nodes lists headless node hosts; /devices lists paired chat/mobile devices.",
      "提示：/nodes 列出无头节点主机；/devices 列出已配对聊天/移动设备。",
    ),
  );
  return { text: lines.join("\n") };
}

async function buildDevicesReply(cfg?: CrawClawConfig): Promise<Reply> {
  const pairing = await listDevicePairing();
  const lines = [
    `📱 ${tr(cfg, "Devices", "设备")}`,
    tr(
      cfg,
      `Pending: ${pairing.pending.length} · Paired: ${pairing.paired.length}`,
      `待配对：${pairing.pending.length} · 已配对：${pairing.paired.length}`,
    ),
  ];
  for (const device of pairing.pending.slice(0, 10)) {
    lines.push(
      `- ${tr(cfg, "pending", "待配对")} ${device.requestId}: ${device.displayName ?? device.deviceId}`,
    );
  }
  for (const device of pairing.paired.slice(0, 10)) {
    const tokens = summarizeDeviceTokens(device.tokens)?.length ?? 0;
    lines.push(
      `- ${tr(cfg, "paired", "已配对")} ${device.deviceId}: ${
        device.displayName ?? tr(cfg, "unnamed", "未命名")
      } · ${tr(cfg, `tokens ${tokens}`, `令牌 ${tokens}`)}`,
    );
  }
  lines.push(
    "",
    tr(
      cfg,
      "Tip: /devices covers chat/mobile pairing; /nodes covers gateway node hosts.",
      "提示：/devices 负责聊天/移动设备配对；/nodes 负责网关节点主机。",
    ),
  );
  return { text: lines.join("\n") };
}

async function buildMemoryReply(cfg?: CrawClawConfig): Promise<Reply> {
  const payload = await callGatewayRead("memory.status", {});
  return {
    text: [
      `🧠 ${tr(cfg, "Memory", "记忆")}`,
      formatUnknownGatewayPayload(payload),
      "",
      tr(
        cfg,
        "Tip: /memory shows provider access; /context explains what enters the prompt.",
        "提示：/memory 显示提供方访问状态；/context 说明哪些内容进入 prompt。",
      ),
    ].join("\n"),
  };
}

async function buildSafeGatewayReply(
  cfg: CrawClawConfig | undefined,
  label: string,
  fn: () => Promise<Reply>,
): Promise<CommandHandlerResult> {
  try {
    return stopWithText(replyText(await fn()));
  } catch (error) {
    return stopWithText(`${tr(cfg, label, label)}: ${formatErrorMessage(error)}`);
  }
}

export const handleQueryCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }
  const token = readCommandToken(params.command.commandBodyNormalized);
  if (!token) {
    return null;
  }
  if (!isQueryCommandToken(token)) {
    return null;
  }
  if (!params.command.isAuthorizedSender) {
    return { shouldContinue: false };
  }

  switch (token) {
    case "skills": {
      const skillCommands =
        params.skillCommands ??
        listSkillCommandsForAgents({
          cfg: params.cfg,
          agentIds: params.agentId ? [params.agentId] : undefined,
        });
      return stopWithText(replyText(buildSkillsQueryReply({ cfg: params.cfg, skillCommands })));
    }
    case "sessions":
      return stopWithText(
        replyText(buildSessionsQueryReply({ cfg: params.cfg, sessionStore: params.sessionStore })),
      );
    case "runtimes":
      return stopWithText(
        replyText(
          buildRuntimesQueryReply({
            cfg: params.cfg,
            manifestPath: resolvePluginRuntimeManifestPath(),
            manifest: readPluginRuntimeManifest(),
          }),
        ),
      );
    case "health":
    case "channels":
      return await buildSafeGatewayReply(params.cfg, token, async () => {
        const summary = await getHealthSnapshot({ probe: false });
        return token === "health"
          ? buildHealthReply(summary, params.cfg)
          : buildChannelsReply(summary, params.cfg);
      });
    case "nodes":
      return await buildSafeGatewayReply(params.cfg, token, () => buildNodesReply(params.cfg));
    case "devices":
      return await buildSafeGatewayReply(params.cfg, token, () => buildDevicesReply(params.cfg));
    case "memory":
      return await buildSafeGatewayReply(params.cfg, token, () => buildMemoryReply(params.cfg));
    default:
      return null;
  }
};
