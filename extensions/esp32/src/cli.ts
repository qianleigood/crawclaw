import type { Command } from "commander";
import type { CrawClawPluginApi, CrawClawPluginCliRegistrar } from "../api.js";
import { readEsp32PluginConfigFromCrawClawConfig } from "./config.js";
import { issueEsp32PairingSession } from "./pairing.js";

type PairStartOpts = {
  name?: string;
};

export function registerEsp32Cli(api: CrawClawPluginApi): CrawClawPluginCliRegistrar {
  return ({ program, config }: { program: Command; config: CrawClawPluginApi["config"] }) => {
    const esp32 = program.command("esp32").description("Manage ESP32-S3-BOX-3 devices");
    const pair = esp32.command("pair").description("Manage ESP32 pairing");
    pair
      .command("start")
      .description("Start a 5 minute ESP32 pairing session")
      .option("--name <name>", "Friendly device name")
      .action(async (opts: PairStartOpts) => {
        const stateDir = api.runtime.state.resolveStateDir();
        const session = await issueEsp32PairingSession({
          stateDir,
          name: opts.name,
          ttlMs: 5 * 60 * 1000,
        });
        const esp32Config = readEsp32PluginConfigFromCrawClawConfig(config);
        const host =
          esp32Config.broker.advertisedHost ??
          esp32Config.broker.bindHost.replace("0.0.0.0", "127.0.0.1");
        console.log(`Pair code: ${session.password}`);
        console.log(`MQTT host: ${host}`);
        console.log(`MQTT port: ${esp32Config.broker.port}`);
        console.log(`MQTT username: ${session.username}`);
        console.log(`Expires at: ${new Date(session.expiresAtMs).toISOString()}`);
        console.log(
          "After the device submits its request, approve it with crawclaw devices approve <requestId>.",
        );
      });
  };
}
