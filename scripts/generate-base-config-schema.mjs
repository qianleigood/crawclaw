#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OUTPUT_PATH = "src/generated/config/schema.base.generated.json";
const LEGACY_OUTPUT_PATH = "src/generated/config/schema.base.generated.ts";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function emitBaseConfigSchemaPayload(generatedAt) {
  const result = spawnSync(
    "cargo",
    [
      "run",
      "-q",
      "-p",
      "crawclaw-runtime",
      "--",
      "emit-base-config-schema",
      "--generated-at",
      generatedAt,
    ],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      [
        "crawclaw-runtime emit-base-config-schema failed",
        result.stderr.trim(),
        result.stdout.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return JSON.parse(result.stdout);
}

export function renderBaseConfigSchemaModule(params = {}) {
  const payload = emitBaseConfigSchemaPayload(params?.generatedAt ?? new Date().toISOString());
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function writeBaseConfigSchemaModule(params = {}) {
  const repoRoot = path.resolve(params?.repoRoot ?? REPO_ROOT);
  const outputPath = path.resolve(repoRoot, params?.outputPath ?? DEFAULT_OUTPUT_PATH);
  const current =
    readIfExists(outputPath) ?? readIfExists(path.resolve(repoRoot, LEGACY_OUTPUT_PATH));
  const generatedAt =
    current?.match(/generatedAt:\s*"([^"]+)"/u)?.[1] ??
    current?.match(/"generatedAt":\s*"([^"]+)"/u)?.[1] ??
    new Date().toISOString();
  const next = renderBaseConfigSchemaModule({ generatedAt });
  const changed = current !== next;

  if (params?.check) {
    return { changed, wrote: false, outputPath };
  }

  if (changed) {
    fs.writeFileSync(outputPath, next, "utf8");
  }
  return { changed, wrote: changed, outputPath };
}

const args = new Set(process.argv.slice(2));
if (args.has("--check") && args.has("--write")) {
  throw new Error("Use either --check or --write, not both.");
}

if (import.meta.url === new URL(process.argv[1] ?? "", "file://").href) {
  const result = writeBaseConfigSchemaModule({ check: args.has("--check") });
  if (result.changed) {
    if (args.has("--check")) {
      console.error(
        `[base-config-schema] stale generated output at ${path.relative(process.cwd(), result.outputPath)}`,
      );
      process.exitCode = 1;
    } else {
      console.log(`[base-config-schema] wrote ${path.relative(process.cwd(), result.outputPath)}`);
    }
  }
}
