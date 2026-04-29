#!/usr/bin/env node
import process from "node:process";
import {
  relativeToRepo,
  writePluginDependencyPlanStatefile,
} from "./lib/plugin-dependency-plan.mjs";

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const writeMode = args.has("--write");

if (checkOnly === writeMode) {
  console.error("Use exactly one of --check or --write.");
  process.exit(1);
}

const repoRoot = process.cwd();
const result = await writePluginDependencyPlanStatefile({
  check: checkOnly,
  repoRoot,
});

if (checkOnly) {
  if (result.changed) {
    console.error(
      [
        "Plugin dependency plan drift detected.",
        `Expected current: ${relativeToRepo(repoRoot, result.jsonPath)}`,
        `Expected current: ${relativeToRepo(repoRoot, result.statefilePath)}`,
        "If this plugin dependency surface change is intentional, run `pnpm plugin-deps:gen` and commit the updated baseline files.",
        "If not intentional, fix the plugin manifest, package metadata, or managed runtime installer change first.",
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(
    `OK ${relativeToRepo(repoRoot, result.jsonPath)} ${relativeToRepo(repoRoot, result.statefilePath)}`,
  );
  process.exit(0);
}

console.log(
  [
    `Wrote ${relativeToRepo(repoRoot, result.jsonPath)}`,
    `Wrote ${relativeToRepo(repoRoot, result.statefilePath)}`,
  ].join("\n"),
);
