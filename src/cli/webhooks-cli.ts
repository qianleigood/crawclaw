import type { Command } from "commander";
import { danger } from "../globals.js";
import {
  type GmailRunOptions,
  type GmailSetupOptions,
  runGmailService,
  runGmailSetup,
} from "../hooks/gmail-ops.js";
import {
  DEFAULT_GMAIL_LABEL,
  DEFAULT_GMAIL_MAX_BYTES,
  DEFAULT_GMAIL_RENEW_MINUTES,
  DEFAULT_GMAIL_SERVE_BIND,
  DEFAULT_GMAIL_SERVE_PATH,
  DEFAULT_GMAIL_SERVE_PORT,
  DEFAULT_GMAIL_SUBSCRIPTION,
  DEFAULT_GMAIL_TOPIC,
} from "../hooks/gmail.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { createCliTranslator } from "./i18n/index.js";
import { getProgramContext } from "./program/program-context.js";

export function registerWebhooksCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const webhooks = program
    .command("webhooks")
    .description(t("command.webhooks.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/webhooks", "docs.crawclaw.ai/cli/webhooks")}\n`,
    );

  const gmail = webhooks.command("gmail").description(t("command.webhooks.gmail.description"));

  gmail
    .command("setup")
    .description(t("command.webhooks.gmail.setup.description"))
    .requiredOption("--account <email>", t("command.webhooks.gmail.option.account"))
    .option("--project <id>", t("command.webhooks.gmail.setup.option.project"))
    .option("--topic <name>", t("command.webhooks.gmail.option.topicName"), DEFAULT_GMAIL_TOPIC)
    .option(
      "--subscription <name>",
      t("command.webhooks.gmail.option.subscription"),
      DEFAULT_GMAIL_SUBSCRIPTION,
    )
    .option("--label <label>", t("command.webhooks.gmail.option.label"), DEFAULT_GMAIL_LABEL)
    .option("--hook-url <url>", t("command.webhooks.gmail.option.hookUrl"))
    .option("--hook-token <token>", t("command.webhooks.gmail.option.hookToken"))
    .option("--push-token <token>", t("command.webhooks.gmail.option.pushToken"))
    .option("--bind <host>", t("command.webhooks.gmail.option.bind"), DEFAULT_GMAIL_SERVE_BIND)
    .option(
      "--port <port>",
      t("command.webhooks.gmail.option.port"),
      String(DEFAULT_GMAIL_SERVE_PORT),
    )
    .option("--path <path>", t("command.webhooks.gmail.option.path"), DEFAULT_GMAIL_SERVE_PATH)
    .option("--include-body", t("command.webhooks.gmail.option.includeBody"), true)
    .option(
      "--max-bytes <n>",
      t("command.webhooks.gmail.option.maxBytes"),
      String(DEFAULT_GMAIL_MAX_BYTES),
    )
    .option(
      "--renew-minutes <n>",
      t("command.webhooks.gmail.option.renewMinutes"),
      String(DEFAULT_GMAIL_RENEW_MINUTES),
    )
    .option("--tailscale <mode>", t("command.webhooks.gmail.option.tailscale"), "funnel")
    .option("--tailscale-path <path>", t("command.webhooks.gmail.option.tailscalePath"))
    .option("--tailscale-target <target>", t("command.webhooks.gmail.option.tailscaleTarget"))
    .option("--push-endpoint <url>", t("command.webhooks.gmail.setup.option.pushEndpoint"))
    .option("--json", t("command.webhooks.gmail.setup.option.json"), false)
    .action(async (opts) => {
      try {
        const parsed = parseGmailSetupOptions(opts);
        await runGmailSetup(parsed);
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  gmail
    .command("run")
    .description(t("command.webhooks.gmail.run.description"))
    .option("--account <email>", t("command.webhooks.gmail.option.account"))
    .option("--topic <topic>", t("command.webhooks.gmail.run.option.topic"))
    .option("--subscription <name>", t("command.webhooks.gmail.option.subscription"))
    .option("--label <label>", t("command.webhooks.gmail.option.label"))
    .option("--hook-url <url>", t("command.webhooks.gmail.option.hookUrl"))
    .option("--hook-token <token>", t("command.webhooks.gmail.option.hookToken"))
    .option("--push-token <token>", t("command.webhooks.gmail.option.pushToken"))
    .option("--bind <host>", t("command.webhooks.gmail.option.bind"))
    .option("--port <port>", t("command.webhooks.gmail.option.port"))
    .option("--path <path>", t("command.webhooks.gmail.option.path"))
    .option("--include-body", t("command.webhooks.gmail.option.includeBody"))
    .option("--max-bytes <n>", t("command.webhooks.gmail.option.maxBytes"))
    .option("--renew-minutes <n>", t("command.webhooks.gmail.option.renewMinutes"))
    .option("--tailscale <mode>", t("command.webhooks.gmail.option.tailscale"))
    .option("--tailscale-path <path>", t("command.webhooks.gmail.option.tailscalePath"))
    .option("--tailscale-target <target>", t("command.webhooks.gmail.option.tailscaleTarget"))
    .action(async (opts) => {
      try {
        const parsed = parseGmailRunOptions(opts);
        await runGmailService(parsed);
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}

function parseGmailSetupOptions(raw: Record<string, unknown>): GmailSetupOptions {
  const accountRaw = raw.account;
  const account = typeof accountRaw === "string" ? accountRaw.trim() : "";
  if (!account) {
    throw new Error("--account is required");
  }
  const common = parseGmailCommonOptions(raw);
  return {
    account,
    project: stringOption(raw.project),
    ...gmailOptionsFromCommon(common),
    pushEndpoint: stringOption(raw.pushEndpoint),
    json: Boolean(raw.json),
  };
}

function parseGmailRunOptions(raw: Record<string, unknown>): GmailRunOptions {
  const common = parseGmailCommonOptions(raw);
  return {
    account: stringOption(raw.account),
    ...gmailOptionsFromCommon(common),
  };
}

function parseGmailCommonOptions(raw: Record<string, unknown>) {
  return {
    topic: stringOption(raw.topic),
    subscription: stringOption(raw.subscription),
    label: stringOption(raw.label),
    hookUrl: stringOption(raw.hookUrl),
    hookToken: stringOption(raw.hookToken),
    pushToken: stringOption(raw.pushToken),
    bind: stringOption(raw.bind),
    port: numberOption(raw.port),
    path: stringOption(raw.path),
    includeBody: booleanOption(raw.includeBody),
    maxBytes: numberOption(raw.maxBytes),
    renewEveryMinutes: numberOption(raw.renewMinutes),
    tailscaleRaw: stringOption(raw.tailscale),
    tailscalePath: stringOption(raw.tailscalePath),
    tailscaleTarget: stringOption(raw.tailscaleTarget),
  };
}

function gmailOptionsFromCommon(
  common: ReturnType<typeof parseGmailCommonOptions>,
): Omit<GmailRunOptions, "account"> {
  return {
    topic: common.topic,
    subscription: common.subscription,
    label: common.label,
    hookUrl: common.hookUrl,
    hookToken: common.hookToken,
    pushToken: common.pushToken,
    bind: common.bind,
    port: common.port,
    path: common.path,
    includeBody: common.includeBody,
    maxBytes: common.maxBytes,
    renewEveryMinutes: common.renewEveryMinutes,
    tailscale: common.tailscaleRaw as GmailRunOptions["tailscale"],
    tailscalePath: common.tailscalePath,
    tailscaleTarget: common.tailscaleTarget,
  };
}

function stringOption(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function numberOption(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return undefined;
  }
  return Math.floor(n);
}

function booleanOption(value: unknown): boolean | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return Boolean(value);
}
