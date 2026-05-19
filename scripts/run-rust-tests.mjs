#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const result = spawnSync("cargo", ["test", "--workspace", "--", "--test-threads=1"], {
  env: {
    ...process.env,
    RUST_MIN_STACK: process.env.RUST_MIN_STACK ?? "16777216",
  },
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
