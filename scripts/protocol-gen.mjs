#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { formatGeneratedModule } from "./lib/format-generated-module.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaOutputPath = path.join(repoRoot, "dist", "protocol.schema.json");
const metadataOutputPath = path.join(
  repoRoot,
  "src",
  "generated",
  "gateway",
  "protocol-contract.generated.ts",
);
const schemaTsOutputPath = path.join(
  repoRoot,
  "src",
  "generated",
  "gateway",
  "protocol-schema.generated.ts",
);

const result = spawnSync(
  "cargo",
  [
    "run",
    "-q",
    "-p",
    "crawclaw-gateway",
    "--",
    "emit-protocol-artifacts",
    "--schema-output",
    schemaOutputPath,
    "--metadata-output",
    metadataOutputPath,
    "--schema-ts-output",
    schemaTsOutputPath,
  ],
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

for (const outputPath of [metadataOutputPath, schemaTsOutputPath]) {
  const source = fs.readFileSync(outputPath, "utf8");
  const formatted = formatGeneratedModule(source, {
    repoRoot,
    outputPath,
    errorLabel: path.relative(repoRoot, outputPath),
  });
  if (formatted !== source) {
    fs.writeFileSync(outputPath, formatted, "utf8");
  }
}
