#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const AGENT_BROWSER_VERSION = "0.27.0";

export function resolveAgentBrowserRuntimePaths(
  runtimeRoot,
  platform = process.platform,
  arch = process.arch,
) {
  const runtimeDir = path.join(runtimeRoot, "runtimes", "browser");
  return {
    runtimeDir,
    binDir: path.join(runtimeDir, "bin"),
    binaryPath: path.join(
      runtimeDir,
      "bin",
      platform === "win32" ? "agent-browser.exe" : "agent-browser",
    ),
    manifestPath: path.join(runtimeDir, "manifest.json"),
    licensePath: path.join(runtimeDir, "LICENSE"),
    sourceLockPath: path.join(runtimeDir, "source.lock.json"),
    packageBinaryName: agentBrowserPackageBinaryName(platform, arch),
  };
}

export function stageAgentBrowserRuntime(params = {}) {
  const runtimeRoot = params.runtimeRoot;
  if (!runtimeRoot) {
    throw new Error("stageAgentBrowserRuntime requires runtimeRoot");
  }
  const platform = params.platform ?? process.platform;
  const arch = params.arch ?? process.arch;
  const env = params.env ?? process.env;
  const runCommand = params.runCommand ?? runCommandSync;
  const paths = resolveAgentBrowserRuntimePaths(runtimeRoot, platform, arch);
  fs.rmSync(paths.runtimeDir, { recursive: true, force: true });
  fs.mkdirSync(paths.binDir, { recursive: true });

  const explicitBinary = env.CRAWCLAW_AGENT_BROWSER_NATIVE_BIN?.trim();
  if (explicitBinary) {
    copyExecutable(explicitBinary, paths.binaryPath, platform);
  } else {
    stageFromNpmPackage({
      runCommand,
      env,
      paths,
      platform,
      arch,
    });
  }

  fs.writeFileSync(
    paths.manifestPath,
    JSON.stringify(
      {
        id: "agent-browser",
        provider: "agent-browser",
        runtime: "rust-native-binary",
        version: AGENT_BROWSER_VERSION,
        binaryPath: path.relative(paths.runtimeDir, paths.binaryPath).replaceAll(path.sep, "/"),
        sourcePackage: "agent-browser",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    paths.sourceLockPath,
    JSON.stringify(
      {
        sourcePackage: "agent-browser",
        version: AGENT_BROWSER_VERSION,
        npmSpec: `agent-browser@${AGENT_BROWSER_VERSION}`,
        runtime: "rust-native-binary",
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  if (!fs.existsSync(paths.licensePath)) {
    fs.writeFileSync(
      paths.licensePath,
      "agent-browser license is bundled from npm package metadata.\n",
      "utf8",
    );
  }
  return paths;
}

function stageFromNpmPackage({ runCommand, env, paths, platform, arch }) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-agent-browser-runtime-"));
  try {
    runChecked(runCommand, {
      cwd: tempDir,
      command: npmCommand(),
      args: ["pack", `agent-browser@${AGENT_BROWSER_VERSION}`, "--json"],
      env,
    });
    const tarball = path.join(tempDir, `agent-browser-${AGENT_BROWSER_VERSION}.tgz`);
    runChecked(runCommand, {
      cwd: tempDir,
      command: "tar",
      args: ["-xzf", tarball],
      env,
    });
    const packageDir = path.join(tempDir, "package");
    const sourceBinary = path.join(
      packageDir,
      "bin",
      agentBrowserPackageBinaryName(platform, arch),
    );
    copyExecutable(sourceBinary, paths.binaryPath, platform);
    const license = path.join(packageDir, "LICENSE");
    if (fs.existsSync(license)) {
      fs.copyFileSync(license, paths.licensePath);
    }
  } finally {
    if (env.CRAWCLAW_KEEP_AGENT_BROWSER_STAGE_TMP !== "1") {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function agentBrowserPackageBinaryName(platform, arch) {
  const normalizedArch = arch === "arm64" ? "arm64" : arch === "x64" ? "x64" : "";
  if (!normalizedArch) {
    throw new Error(`Unsupported agent-browser architecture: ${arch}`);
  }
  if (platform === "darwin") {
    return `agent-browser-darwin-${normalizedArch}`;
  }
  if (platform === "linux") {
    return `agent-browser-linux-${normalizedArch}`;
  }
  if (platform === "win32") {
    if (normalizedArch !== "x64") {
      throw new Error(`Unsupported agent-browser Windows architecture: ${arch}`);
    }
    return "agent-browser-win32-x64.exe";
  }
  throw new Error(`Unsupported agent-browser platform: ${platform}`);
}

function copyExecutable(source, dest, platform) {
  if (!fs.existsSync(source)) {
    throw new Error(`Missing agent-browser native binary: ${source}`);
  }
  fs.copyFileSync(source, dest);
  if (platform !== "win32") {
    fs.chmodSync(dest, 0o755);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function runChecked(runCommand, invocation) {
  const result = runCommand(invocation);
  if (result.status === 0) {
    return;
  }
  const suffix = result.signal ? `signal ${result.signal}` : `exit ${String(result.status)}`;
  throw new Error(
    `${invocation.command} ${invocation.args.join(" ")} failed in ${invocation.cwd} with ${suffix}`,
  );
}

function runCommandSync({ cwd, command, args, env, stdio = "inherit" }) {
  return spawnSync(command, args, {
    cwd,
    env,
    stdio,
    encoding: "utf-8",
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const runtimeRoot = process.argv[2];
  if (!runtimeRoot) {
    console.error("usage: stage-agent-browser-runtime.mjs <runtime-root>");
    process.exit(2);
  }
  stageAgentBrowserRuntime({ runtimeRoot });
}
