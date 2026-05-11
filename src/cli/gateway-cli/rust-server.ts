import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  GatewayAuthConfig,
  GatewayBindMode,
  GatewayTailscaleConfig,
} from "../../config/config.js";

type RustGatewayCloseOptions = {
  reason?: string;
  restartExpectedMs?: number | null;
};

export type RustGatewayServerHandle = {
  close(options?: RustGatewayCloseOptions): Promise<void>;
};

type RustGatewayServerOptions = {
  bind: GatewayBindMode;
  customBindHost?: string | undefined;
  auth?: GatewayAuthConfig | undefined;
  tailscale?: GatewayTailscaleConfig | undefined;
};

type RustGatewayExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
};

const READY_TIMEOUT_MS = 8_000;
const CLOSE_TIMEOUT_MS = 3_000;

export async function startRustGatewayServer(
  port: number,
  options: RustGatewayServerOptions,
): Promise<RustGatewayServerHandle> {
  assertUnsupportedModes(options);

  const binary = resolveRustGatewayBinary();
  const bindHost = resolveRustGatewayBind(options.bind, options.customBindHost);
  const args = ["--bind", bindHost, "--port", String(port)];
  const runtimeRoot = process.env.CRAWCLAW_RUNTIME_ROOT?.trim();
  if (runtimeRoot) {
    args.push("--runtime-root", runtimeRoot);
  }

  const child = spawn(binary, args, {
    cwd: process.cwd(),
    env: buildRustGatewayEnv(options.auth),
    stdio: ["ignore", "inherit", "inherit"],
  });

  const exitPromise = waitForExit(child);
  await waitForReady(port, exitPromise);

  return {
    async close(_options?: RustGatewayCloseOptions): Promise<void> {
      if (child.exitCode !== null || child.signalCode !== null) {
        await exitPromise;
        return;
      }
      child.kill("SIGTERM");
      const exited = await Promise.race([
        exitPromise.then(() => true),
        sleep(CLOSE_TIMEOUT_MS).then(() => false),
      ]);
      if (!exited) {
        child.kill("SIGKILL");
        await exitPromise;
      }
    },
  };
}

export function resolveRustGatewayBinary(env: NodeJS.ProcessEnv = process.env): string {
  const envBinary = env.CRAWCLAW_GATEWAY_BIN?.trim();
  if (envBinary) {
    return envBinary;
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const name = process.platform === "win32" ? "crawclaw-gateway.exe" : "crawclaw-gateway";
  const candidates = [
    path.join(root, "dist", "native", name),
    path.join(root, "target", "debug", name),
    path.join(root, "target", "release", name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `Rust Gateway binary not found. Build native binaries first or set CRAWCLAW_GATEWAY_BIN. Checked: ${candidates.join(", ")}`,
  );
}

function resolveRustGatewayBind(bind: GatewayBindMode, customBindHost: string | undefined): string {
  switch (bind) {
    case "auto":
    case "loopback":
      return "127.0.0.1";
    case "lan":
      return "0.0.0.0";
    case "custom": {
      const host = customBindHost?.trim();
      if (host === "127.0.0.1" || host === "localhost" || host === "loopback") {
        return "127.0.0.1";
      }
      if (host === "0.0.0.0" || host === "lan") {
        return "0.0.0.0";
      }
      throw new Error(
        "Rust Gateway only supports custom bind hosts 127.0.0.1, localhost, loopback, 0.0.0.0, or lan.",
      );
    }
    case "tailnet":
      throw new Error("Rust Gateway does not support bind=tailnet. Use bind=loopback or bind=lan.");
    default: {
      const unsupported: never = bind;
      throw new Error(`Unsupported Rust Gateway bind mode: ${String(unsupported)}`);
    }
  }
}

function assertUnsupportedModes(options: RustGatewayServerOptions): void {
  const tailscaleMode = options.tailscale?.mode;
  if ((tailscaleMode && tailscaleMode !== "off") || options.tailscale?.resetOnExit) {
    throw new Error("Rust Gateway does not support Tailscale serve/funnel/reset mode yet.");
  }
}

function buildRustGatewayEnv(auth: GatewayAuthConfig | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!auth) {
    return env;
  }

  delete env.CRAWCLAW_GATEWAY_TOKEN;
  delete env.CRAWCLAW_GATEWAY_PASSWORD;
  if (auth.mode === "token" && typeof auth.token === "string" && auth.token.trim()) {
    env.CRAWCLAW_GATEWAY_TOKEN = auth.token;
  }
  if (auth.mode === "password" && typeof auth.password === "string" && auth.password.trim()) {
    env.CRAWCLAW_GATEWAY_PASSWORD = auth.password;
  }
  return env;
}

function waitForExit(child: ChildProcess): Promise<RustGatewayExit> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
    child.once("error", (error) => resolve({ code: null, signal: null, error }));
  });
}

async function waitForReady(port: number, exitPromise: Promise<RustGatewayExit>): Promise<void> {
  let exit: RustGatewayExit | undefined;
  void exitPromise.then((value) => {
    exit = value;
  });

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exit) {
      throw formatExitError(exit);
    }
    if (await probeHealth(port)) {
      return;
    }
    await sleep(100);
  }
  if (exit) {
    throw formatExitError(exit);
  }
  throw new Error(
    `Rust Gateway did not become ready on port ${port} within ${READY_TIMEOUT_MS}ms.`,
  );
}

function probeHealth(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: "127.0.0.1",
        path: "/health",
        port,
        timeout: 500,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("error", () => resolve(false));
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
  });
}

function formatExitError(exit: RustGatewayExit): Error {
  if (exit.error) {
    return exit.error;
  }
  return new Error(
    `Rust Gateway exited before becoming ready (code=${exit.code}, signal=${exit.signal}).`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
