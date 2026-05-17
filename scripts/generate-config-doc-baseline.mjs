#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

if (checkOnly && args.has("--write")) {
  console.error("Use either --check or --write, not both.");
  process.exit(1);
}

const result = spawnSync(
  "cargo",
  [
    "run",
    "-q",
    "-p",
    "crawclaw-runtime",
    "--",
    "emit-config-doc-baseline",
    "--json-output",
    "docs/.generated/config-baseline.json",
    "--jsonl-output",
    "docs/.generated/config-baseline.jsonl",
    checkOnly ? "--check" : "--write",
  ],
  {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    stdio: "inherit",
  },
);

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);
