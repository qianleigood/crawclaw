#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const runtimeStackTests = [
  "src/agents/special/runtime/lifecycle-subscriber.test.ts",
  "src/agents/special/runtime/observability.test.ts",
  "src/agents/special/runtime/definition-presets.test.ts",
  "src/agents/special/runtime/result-detail.test.ts",
  "src/agents/special/runtime/registry.test.ts",
];

const extraArgs = process.argv.slice(2);
const result = spawnSync(
  "node",
  [
    "scripts/test-parallel.mjs",
    "--profile",
    "serial",
    ...runtimeStackTests.flatMap((file) => ["--files", file]),
    ...extraArgs,
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      CRAWCLAW_TEST_PROFILE: process.env.CRAWCLAW_TEST_PROFILE ?? "serial",
    },
  },
);

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
