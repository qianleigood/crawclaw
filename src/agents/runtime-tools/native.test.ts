import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCrawClawRuntimeTool, shutdownCrawClawRuntimeWorkersForTests } from "./native.js";

async function createFakeRuntime(dir: string) {
  const runtime = path.join(dir, "fake-runtime.mjs");
  await fs.writeFile(
    runtime,
    `#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline";

fs.appendFileSync(process.env.CRAWCLAW_RUNTIME_SPAWN_LOG, "spawn\\n");

if (process.argv.includes("--worker")) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const request = JSON.parse(line);
    process.stdout.write(JSON.stringify({
      id: request.id,
      ok: true,
      result: {
        pid: process.pid,
        tool: request.tool,
        input: request.input
      }
    }) + "\\n");
  });
} else {
  process.stdout.write(JSON.stringify({
    ok: true,
    result: { pid: process.pid, tool: process.argv.at(-1) }
  }) + "\\n");
}
`,
    "utf8",
  );
  await fs.chmod(runtime, 0o755);
  return runtime;
}

describe("crawclaw runtime native adapter", () => {
  afterEach(() => {
    shutdownCrawClawRuntimeWorkersForTests();
  });

  it("reuses a long-lived worker for default runtime tool calls", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-runtime-native-"));
    const runtime = await createFakeRuntime(dir);
    const spawnLog = path.join(dir, "spawn.log");
    const env = {
      ...process.env,
      CRAWCLAW_RUNTIME_BIN: runtime,
      CRAWCLAW_RUNTIME_SPAWN_LOG: spawnLog,
    };

    const first = await runCrawClawRuntimeTool<{ pid: number; tool: string }>(
      "grep",
      { pattern: "alpha" },
      { env },
    );
    const second = await runCrawClawRuntimeTool<{ pid: number; tool: string }>("ls", {}, { env });

    expect(first.tool).toBe("grep");
    expect(second.tool).toBe("ls");
    expect(second.pid).toBe(first.pid);
    const spawns = (await fs.readFile(spawnLog, "utf8")).trim().split("\n");
    expect(spawns).toHaveLength(1);
  });
});
