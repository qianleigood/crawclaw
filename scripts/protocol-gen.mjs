#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(repoRoot, "dist", "protocol.schema.json");

const result = spawnSync(
  "cargo",
  ["run", "-q", "-p", "crawclaw-gateway", "--", "emit-protocol-schema", "--output", outputPath],
  {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
);

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(
    ["crawclaw-gateway emit-protocol-schema failed", result.stderr.trim(), result.stdout.trim()]
      .filter(Boolean)
      .join("\n"),
  );
}
process.stdout.write(result.stdout);
