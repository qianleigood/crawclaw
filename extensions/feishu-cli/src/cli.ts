import type { Command } from "commander";
import type { PluginLogger } from "crawclaw/plugin-sdk/plugin-entry";
import type { FeishuCliPluginConfig } from "./config.js";
import { getFeishuCliStatus, runInteractiveLarkCliCommand } from "./lark-cli.js";

type FeishuCliLocale = "en" | "zh-CN";

function feishuCliText(locale: FeishuCliLocale | undefined, en: string, zhCN: string): string {
  return locale === "zh-CN" ? zhCN : en;
}

function printStatusHuman(status: Awaited<ReturnType<typeof getFeishuCliStatus>>): void {
  console.log(`Identity: ${status.identity}`);
  console.log(`Enabled: ${status.enabled ? "yes" : "no"}`);
  console.log(`Installed: ${status.installed ? "yes" : "no"}`);
  console.log(`Status: ${status.status}`);
  console.log(`Command: ${status.command}`);
  if (status.profile) {
    console.log(`Profile: ${status.profile}`);
  }
  if (status.version) {
    console.log(`Version: ${status.version}`);
  }
  if (status.message) {
    console.log(`Message: ${status.message}`);
  }
  if (status.hint) {
    console.log(`Hint: ${status.hint}`);
  }
}

export function registerFeishuCliCli(params: {
  program: Command;
  config: FeishuCliPluginConfig;
  logger?: PluginLogger;
  locale?: FeishuCliLocale;
}): void {
  const text = (en: string, zhCN: string) => feishuCliText(params.locale, en, zhCN);
  const command = params.program
    .command("feishu-cli")
    .description(
      text(
        "Inspect Feishu user-identity tooling via the official lark-cli",
        "通过官方 lark-cli 检查飞书用户身份工具",
      ),
    )
    .action(() => {
      command.outputHelp();
      process.exitCode = 1;
    });

  const auth = command
    .command("auth")
    .description(
      text(
        "Manage the lark-cli user session through CrawClaw",
        "通过 CrawClaw 管理 lark-cli 用户会话",
      ),
    )
    .action(() => {
      auth.outputHelp();
      process.exitCode = 1;
    });

  command
    .command("status")
    .description(
      text("Show Feishu CLI installation and auth status", "显示飞书 CLI 安装和认证状态"),
    )
    .option("--json", text("Print machine-readable JSON", "打印机器可读 JSON"), false)
    .option(
      "--verify",
      text("Verify auth token against the server", "向服务端验证认证 token"),
      false,
    )
    .action(async (opts) => {
      try {
        const status = await getFeishuCliStatus({
          config: params.config,
          verify: Boolean(opts.verify),
        });
        if (opts.json) {
          console.log(JSON.stringify(status, null, 2));
          return;
        }
        printStatusHuman(status);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logger?.error?.(`feishu-cli status failed: ${message}`);
        console.error(message);
        process.exitCode = 1;
      }
    });

  auth
    .command("login")
    .description(
      text("Launch the interactive lark-cli auth login flow", "启动交互式 lark-cli 登录流程"),
    )
    .action(() => {
      try {
        const exitCode = runInteractiveLarkCliCommand({
          config: params.config,
          args: ["auth", "login"],
        });
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logger?.error?.(`feishu-cli auth login failed: ${message}`);
        console.error(message);
        process.exitCode = 1;
      }
    });

  auth
    .command("logout")
    .description(
      text("Launch the interactive lark-cli auth logout flow", "启动交互式 lark-cli 登出流程"),
    )
    .action(() => {
      try {
        const exitCode = runInteractiveLarkCliCommand({
          config: params.config,
          args: ["auth", "logout"],
        });
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logger?.error?.(`feishu-cli auth logout failed: ${message}`);
        console.error(message);
        process.exitCode = 1;
      }
    });
}
