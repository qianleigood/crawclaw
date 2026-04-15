import { Type } from "@sinclair/typebox";
import { emptyPluginConfigSchema } from "crawclaw/plugin-sdk/plugin-entry";

export type FeishuCliPluginConfig = {
  enabled: boolean;
  command: string;
  profile?: string;
  timeoutMs: number;
};

const DEFAULT_COMMAND = "lark-cli";
const DEFAULT_TIMEOUT_MS = 30_000;

export const FeishuCliPluginConfigType = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    command: Type.Optional(Type.String({ minLength: 1 })),
    profile: Type.Optional(Type.String({ minLength: 1 })),
    timeoutMs: Type.Optional(Type.Number({ minimum: 1_000 })),
  },
  {
    additionalProperties: false,
  },
);

export const feishuCliConfigSchema = {
  ...emptyPluginConfigSchema,
  parse(value: unknown): FeishuCliPluginConfig {
    return parseFeishuCliConfig(value);
  },
  uiHints: {
    enabled: {
      label: "Enable Feishu CLI user tools",
      help: "Uses user identity through lark-cli. Separate from the Feishu bot/channel plugin.",
    },
    command: {
      label: "lark-cli command",
      help: "Executable used for Feishu user tools.",
      placeholder: DEFAULT_COMMAND,
    },
    profile: {
      label: "CLI profile",
      help: "Optional lark-cli profile name for user auth state.",
    },
    timeoutMs: {
      label: "Command timeout (ms)",
      help: "Timeout used for lark-cli status probes and user-tool calls.",
    },
  },
  jsonSchema: FeishuCliPluginConfigType,
};

export function parseFeishuCliConfig(value: unknown): FeishuCliPluginConfig {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const command =
    typeof raw.command === "string" && raw.command.trim() ? raw.command.trim() : DEFAULT_COMMAND;
  const profile =
    typeof raw.profile === "string" && raw.profile.trim() ? raw.profile.trim() : undefined;
  const timeoutMs =
    typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs) && raw.timeoutMs >= 1_000
      ? Math.floor(raw.timeoutMs)
      : DEFAULT_TIMEOUT_MS;
  const enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;

  return {
    enabled,
    command,
    ...(profile ? { profile } : {}),
    timeoutMs,
  };
}
