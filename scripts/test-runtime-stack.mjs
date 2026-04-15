#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const runtimeStackTests = [
  "src/memory/engine/context-memory-runtime.prompt.test.ts",
  "src/memory/engine/context-memory-runtime.lifecycle.test.ts",
  "src/memory/engine/context-memory-runtime.archive.test.ts",
  "src/memory/session-summary/agent-runner.test.ts",
  "src/memory/durable/agent-runner.test.ts",
  "src/memory/dreaming/agent-runner.test.ts",
  "src/agents/pi-embedded-runner/run/attempt.memory-runtime-helpers.test.ts",
  "src/agents/pi-embedded-runner/run/attempt.memory-flush-forwarding.test.ts",
  "src/agents/pi-embedded-runner/run/attempt.provider-lifecycle.test.ts",
  "src/agents/pi-embedded-runner/run/attempt.spawn-workspace.memory-runtime.test.ts",
  "src/agents/pi-embedded-runner/run/attempt.spawn-workspace.sessions-spawn.test.ts",
  "src/agents/pi-embedded-runner/run/attempt.spawn-workspace.cache-ttl.test.ts",
  "src/agents/pi-embedded-runner/run/attempt.special-inherited-envelope.test.ts",
  "src/agents/special/runtime/run-once.test.ts",
  "src/agents/special/runtime/lifecycle-subscriber.test.ts",
  "src/agents/special/runtime/observability.test.ts",
  "src/agents/special/runtime/cache-safe-params.test.ts",
  "src/agents/special/runtime/registry.test.ts",
  "src/commands/agent.inspect.test.ts",
  "ui/src/ui/controllers/agents.test.ts",
  "ui/src/ui/views/agents.test.ts",
  "ui/src/ui/views/chat.test.ts",
  "ui/src/ui/views/sessions.test.ts",
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
