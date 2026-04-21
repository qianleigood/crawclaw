import type { Command } from "commander";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { formatHelpExamples } from "../help-format.js";
import { registerNodesCameraCommands } from "./register.camera.js";
import { registerNodesCanvasCommands } from "./register.canvas.js";
import { registerNodesInvokeCommands } from "./register.invoke.js";
import { registerNodesLocationCommands } from "./register.location.js";
import { registerNodesNotifyCommand } from "./register.notify.js";
import { registerNodesPairingCommands } from "./register.pairing.js";
import { registerNodesPushCommand } from "./register.push.js";
import { registerNodesScreenCommands } from "./register.screen.js";
import { registerNodesStatusCommands } from "./register.status.js";
import { getCommandTranslator } from "./rpc.js";

export function registerNodesCli(program: Command) {
  const t = getCommandTranslator(program);
  const nodes = program
    .command("nodes")
    .description(t("command.nodes.fullDescription"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw nodes status", t("command.nodes.example.status")],
          ["crawclaw nodes pairing pending", t("command.nodes.example.pairingPending")],
          [
            'crawclaw nodes invoke --node <id> --command system.which --params \'{"name":"uname"}\'',
            t("command.nodes.example.invoke"),
          ],
          ["crawclaw nodes camera snap --node <id>", t("command.nodes.example.cameraSnap")],
        ])}\n\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/nodes", "docs.crawclaw.ai/cli/nodes")}\n`,
    );

  registerNodesStatusCommands(nodes);
  registerNodesPairingCommands(nodes);
  registerNodesInvokeCommands(nodes);
  registerNodesNotifyCommand(nodes);
  registerNodesPushCommand(nodes);
  registerNodesCanvasCommands(nodes);
  registerNodesCameraCommands(nodes);
  registerNodesScreenCommands(nodes);
  registerNodesLocationCommands(nodes);
}
