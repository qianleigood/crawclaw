import type { Command } from "commander";
import type { PluginLogger } from "crawclaw/plugin-sdk/plugin-entry";
import type { FeishuCliPluginConfig } from "./config.js";
import { getFeishuCliStatus, runInteractiveLarkCliCommand } from "./lark-cli.js";

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
}): void {
  const command = params.program
    .command("feishu-cli")
    .description("Inspect Feishu user-identity tooling via the official lark-cli")
    .action(() => {
      command.outputHelp();
      process.exitCode = 1;
    });

  const auth = command
    .command("auth")
    .description("Manage the lark-cli user session through CrawClaw")
    .action(() => {
      auth.outputHelp();
      process.exitCode = 1;
    });

  command
    .command("status")
    .description("Show Feishu CLI installation and auth status")
    .option("--json", "Print machine-readable JSON", false)
    .option("--verify", "Verify auth token against the server", false)
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
    .description("Launch the interactive lark-cli auth login flow")
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
    .description("Launch the interactive lark-cli auth logout flow")
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
