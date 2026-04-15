import { Type } from "@sinclair/typebox";
import type { CrawClawPluginApi } from "crawclaw/plugin-sdk/plugin-entry";
import { jsonResult, readStringParam, ToolInputError, type AnyAgentTool } from "../../../src/agents/tools/common.js";
import type { FeishuCliPluginConfig } from "./config.js";
import { runFeishuCliUserCommand } from "./lark-cli.js";

const FeishuUserCalendarSchema = Type.Object(
  {
    action: Type.Optional(Type.Literal("agenda")),
    calendar_id: Type.Optional(Type.String()),
    start: Type.Optional(Type.String()),
    end: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const FeishuUserTaskSchema = Type.Object(
  {
    action: Type.Union([Type.Literal("list_my_tasks"), Type.Literal("create")]),
    query: Type.Optional(Type.String()),
    complete: Type.Optional(Type.Boolean()),
    due_start: Type.Optional(Type.String()),
    due_end: Type.Optional(Type.String()),
    page_all: Type.Optional(Type.Boolean()),
    summary: Type.Optional(Type.String()),
    description: Type.Optional(Type.String()),
    due: Type.Optional(Type.String()),
    tasklist_id: Type.Optional(Type.String()),
    assignee: Type.Optional(Type.String()),
    idempotency_key: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

const FeishuUserMessagesSchema = Type.Object(
  {
    action: Type.Optional(Type.Literal("search")),
    query: Type.Optional(Type.String()),
    chat_id: Type.Optional(Type.String()),
    chat_type: Type.Optional(Type.Union([Type.Literal("group"), Type.Literal("p2p")])),
    sender: Type.Optional(Type.String()),
    start: Type.Optional(Type.String()),
    end: Type.Optional(Type.String()),
    include_attachment_type: Type.Optional(
      Type.Union([
        Type.Literal("file"),
        Type.Literal("image"),
        Type.Literal("video"),
        Type.Literal("link"),
      ]),
    ),
    is_at_me: Type.Optional(Type.Boolean()),
    page_all: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

function pushStringFlag(argv: string[], flag: string, value: string | undefined): void {
  if (value) {
    argv.push(flag, value);
  }
}

function pushBooleanFlag(argv: string[], flag: string, value: unknown): void {
  if (value === true) {
    argv.push(flag);
  }
}

export function createFeishuUserCalendarTool(config: FeishuCliPluginConfig): AnyAgentTool {
  return {
    name: "feishu_user_calendar",
    label: "Feishu User Calendar",
    description:
      "Use the official lark-cli with user identity to inspect your personal Feishu calendar agenda. This is separate from the Feishu bot/channel plugin.",
    parameters: FeishuUserCalendarSchema,
    async execute(_toolCallId, args) {
      const params = args as Record<string, unknown>;
      const argv = ["calendar", "+agenda", "--as", "user", "--format", "json"];
      pushStringFlag(argv, "--calendar-id", readStringParam(params, "calendar_id"));
      pushStringFlag(argv, "--start", readStringParam(params, "start"));
      pushStringFlag(argv, "--end", readStringParam(params, "end"));
      const payload = await runFeishuCliUserCommand({
        config,
        args: argv,
        actionLabel: "feishu user calendar agenda",
      });
      return jsonResult({
        ok: true,
        identity: "user",
        domain: "calendar",
        action: "agenda",
        data: payload,
      });
    },
  };
}

export function createFeishuUserTaskTool(config: FeishuCliPluginConfig): AnyAgentTool {
  return {
    name: "feishu_user_task",
    label: "Feishu User Task",
    description:
      "Use the official lark-cli with user identity to list or create Feishu tasks for the authenticated user.",
    parameters: FeishuUserTaskSchema,
    async execute(_toolCallId, args) {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      let argv: string[];
      if (action === "list_my_tasks") {
        argv = ["task", "+get-my-tasks", "--as", "user", "--format", "json"];
        pushStringFlag(argv, "--query", readStringParam(params, "query"));
        pushBooleanFlag(argv, "--complete", params.complete);
        pushStringFlag(argv, "--due-start", readStringParam(params, "due_start"));
        pushStringFlag(argv, "--due-end", readStringParam(params, "due_end"));
        pushBooleanFlag(argv, "--page-all", params.page_all);
      } else if (action === "create") {
        const summary = readStringParam(params, "summary", { required: true });
        argv = ["task", "+create", "--as", "user", "--format", "json", "--summary", summary];
        pushStringFlag(argv, "--description", readStringParam(params, "description"));
        pushStringFlag(argv, "--due", readStringParam(params, "due"));
        pushStringFlag(argv, "--tasklist-id", readStringParam(params, "tasklist_id"));
        pushStringFlag(argv, "--assignee", readStringParam(params, "assignee"));
        pushStringFlag(argv, "--idempotency-key", readStringParam(params, "idempotency_key"));
      } else {
        throw new ToolInputError(`Unsupported feishu_user_task action: ${action}`);
      }
      const payload = await runFeishuCliUserCommand({
        config,
        args: argv,
        actionLabel: `feishu user task ${action}`,
      });
      return jsonResult({
        ok: true,
        identity: "user",
        domain: "task",
        action,
        data: payload,
      });
    },
  };
}

export function createFeishuUserMessagesTool(config: FeishuCliPluginConfig): AnyAgentTool {
  return {
    name: "feishu_user_messages",
    label: "Feishu User Messages",
    description:
      "Use the official lark-cli with user identity to search Feishu messages across your accessible chats.",
    parameters: FeishuUserMessagesSchema,
    async execute(_toolCallId, args) {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const argv = ["im", "+messages-search", "--as", "user", "--format", "json", "--query", query];
      pushStringFlag(argv, "--chat-id", readStringParam(params, "chat_id"));
      pushStringFlag(argv, "--chat-type", readStringParam(params, "chat_type"));
      pushStringFlag(argv, "--sender", readStringParam(params, "sender"));
      pushStringFlag(argv, "--start", readStringParam(params, "start"));
      pushStringFlag(argv, "--end", readStringParam(params, "end"));
      pushStringFlag(
        argv,
        "--include-attachment-type",
        readStringParam(params, "include_attachment_type"),
      );
      pushBooleanFlag(argv, "--is-at-me", params.is_at_me);
      pushBooleanFlag(argv, "--page-all", params.page_all);
      const payload = await runFeishuCliUserCommand({
        config,
        args: argv,
        actionLabel: "feishu user messages search",
      });
      return jsonResult({
        ok: true,
        identity: "user",
        domain: "messages",
        action: "search",
        data: payload,
      });
    },
  };
}

export function registerFeishuCliTools(
  api: Pick<CrawClawPluginApi, "registerTool" | "logger">,
  config: FeishuCliPluginConfig,
): void {
  api.registerTool(createFeishuUserCalendarTool(config), { name: "feishu_user_calendar" });
  api.registerTool(createFeishuUserTaskTool(config), { name: "feishu_user_task" });
  api.registerTool(createFeishuUserMessagesTool(config), { name: "feishu_user_messages" });
  api.logger.info?.("feishu-cli: registered Feishu user-identity tools");
}
