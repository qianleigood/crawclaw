import { spawn } from "node:child_process";

const maxOldSpaceSize = process.env.CRAWCLAW_TSC_MAX_OLD_SPACE_SIZE?.trim() || "8192";
const child = spawn(
  process.execPath,
  [
    `--max-old-space-size=${maxOldSpaceSize}`,
    "./node_modules/typescript/bin/tsc",
    "--noEmit",
    ...process.argv.slice(2),
  ],
  {
    stdio: "inherit",
    env: process.env,
    cwd: process.cwd(),
  },
);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
