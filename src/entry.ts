#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isMainModule } from "./infra/is-main.js";

export const CLI_REMOVED_MESSAGE =
  "CrawClaw no longer exposes a Node CLI entrypoint. Use CrawClaw Desktop or the local Gateway API.";

if (
  isMainModule({
    currentFile: fileURLToPath(import.meta.url),
  })
) {
  console.error(CLI_REMOVED_MESSAGE);
  process.exit(1);
}
