import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertCrawClawDesktopTauriReleaseInputs,
  resolveCrawClawDesktopTauriRuntimeStagePaths,
  stageCrawClawDesktopTauriRuntime,
} from "../../scripts/crawclaw-desktop-tauri-runtime.mjs";

void describe("crawclaw tauri desktop runtime staging", () => {
  void it("stages the embedded CrawClaw runtime under the Tauri app", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-stage-"));
    const paths = resolveCrawClawDesktopTauriRuntimeStagePaths(rootDir);
    const node24Root = writeSourceNode24Runtime(rootDir);
    fs.mkdirSync(paths.runtimeRoot, { recursive: true });
    fs.writeFileSync(path.join(paths.runtimeRoot, "stale.txt"), "stale\n", "utf8");

    const calls = [];
    stageCrawClawDesktopTauriRuntime({
      rootDir,
      env: { PATH: "/usr/bin", CRAWCLAW_DESKTOP_NODE24_ROOT: node24Root },
      runCommand({ cwd, command, args, env }) {
        calls.push({ cwd, command, args, env });
        if (command === "cargo" && args.includes("build")) {
          const targetDir = path.join(rootDir, "target", "release");
          fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(paths.sourceRuntimeBinaryPath, "#!/bin/sh\nexit 0\n", "utf8");
          fs.writeFileSync(paths.sourceGatewayBinaryPath, "#!/bin/sh\nexit 0\n", "utf8");
          fs.writeFileSync(paths.sourceNativePluginsBinaryPath, "#!/bin/sh\nexit 0\n", "utf8");
        }
        if (command === paths.sourceRuntimeBinaryPath && args[0] === "stage") {
          writeRuntimeManifests(paths.runtimeRoot);
        }
        if (command === paths.nodeBinaryPath && args.includes("agent-browser@0.27.0")) {
          writeEmbeddedBrowserRuntime(paths.runtimeRoot);
        }
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
    });

    assert.deepEqual(
      calls.map((call) => ({ cwd: call.cwd, command: call.command, args: call.args })),
      [
        {
          cwd: rootDir,
          command: "cargo",
          args: [
            "build",
            "-p",
            "crawclaw-runtime",
            "-p",
            "crawclaw-gateway",
            "-p",
            "crawclaw-native-plugins",
            "--release",
          ],
        },
        {
          cwd: rootDir,
          command: paths.sourceRuntimeBinaryPath,
          args: ["stage", "--output", paths.runtimeRoot],
        },
        {
          cwd: paths.runtimeRoot,
          command: paths.nodeBinaryPath,
          args: [
            path.join(paths.nodeRuntimeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
            "install",
            "--global=false",
            "--prefix",
            path.join(paths.runtimeRoot, "runtimes", "browser"),
            "--no-save",
            "--package-lock=false",
            "agent-browser@0.27.0",
          ],
        },
      ],
    );
    assert.equal(calls.at(-1).env.CRAWCLAW_STATE_DIR, paths.runtimeRoot);
    assert.equal(
      calls.at(-1).env.CRAWCLAW_PLUGIN_RUNTIMES_DIR,
      path.join(paths.runtimeRoot, "runtimes"),
    );
    assert.equal(calls.at(-1).env.CRAWCLAW_DESKTOP_NODE24_BIN, paths.nodeBinaryPath);
    assert.ok(calls.at(-1).env.PATH.startsWith(path.dirname(paths.nodeBinaryPath)));
    assert.equal(calls.at(-1).env.CRAWCLAW_RUNTIME_INSTALL_PROFILE, undefined);
    assert.equal(fs.existsSync(path.join(paths.runtimeRoot, "stale.txt")), false);
    assert.equal(fs.existsSync(paths.runtimeBinaryPath), true);
    assert.equal(fs.existsSync(paths.gatewayBinaryPath), true);
    assert.equal(fs.existsSync(paths.nativePluginsBinaryPath), true);
    assert.equal(fs.existsSync(path.join(paths.runtimeRoot, "bin", "crawclaw")), false);
    assert.equal(fs.existsSync(paths.nodeBinaryPath), true);
    assert.equal(fs.existsSync(paths.npmBinaryPath), true);
    assert.equal(
      fs.existsSync(
        path.join(
          paths.runtimeRoot,
          "runtimes",
          "browser",
          "node_modules",
          ".bin",
          "agent-browser",
        ),
      ),
      true,
    );
  });

  void it("release check requires the Tauri app and embedded runtime", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-release-"));
    writeReleaseFixture(rootDir);

    assert.doesNotThrow(() =>
      assertCrawClawDesktopTauriReleaseInputs({
        rootDir,
        checkGeneratedPaths: false,
        spawnSyncImpl() {
          return { status: 0, signal: null, stdout: "", stderr: "" };
        },
      }),
    );
  });

  void it("release check smokes the embedded Rust runtime without desktop bridge", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-release-smoke-"));
    writeReleaseFixture(rootDir);
    const calls = [];

    assertCrawClawDesktopTauriReleaseInputs({
      rootDir,
      checkGeneratedPaths: false,
      spawnSyncImpl(command, args, options) {
        calls.push({ command, args, cwd: options?.cwd });
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
    });

    const argv = calls.map((call) => call.args.join(" "));
    assert.ok(argv.some((args) => args.includes("status --json")));
    assert.ok(argv.some((args) => args.includes("--help")));
    assert.ok(calls.some((call) => String(call.command).includes("crawclaw-gateway")));
    assert.ok(calls.some((call) => String(call.command).includes("crawclaw-runtime")));
    assert.ok(calls.every((call) => !String(call.command).endsWith("/crawclaw")));
    assert.ok(argv.every((args) => !args.includes("desktop-api snapshot --json")));
    assert.ok(argv.every((args) => !args.includes("desktop-runtime status --json")));
  });

  void it("release check rejects missing runtime release inputs", () => {
    const cases = [
      ["binary", /embedded Rust runtime binary/],
      ["manifest", /embedded managed plugin runtime manifest/],
      ["channels", /embedded Rust channel manifest/],
      ["providers", /embedded Rust provider transport manifest/],
      ["plugins", /embedded Rust plugin manifest/],
    ];

    for (const [omit, expectedMessage] of cases) {
      const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-release-missing-"));
      writeReleaseFixture(rootDir, { omit });

      assert.throws(
        () =>
          assertCrawClawDesktopTauriReleaseInputs({
            rootDir,
            checkGeneratedPaths: false,
            spawnSyncImpl() {
              return { status: 0, signal: null, stdout: "", stderr: "" };
            },
          }),
        expectedMessage,
      );
    }
  });

  void it("release check rejects missing embedded agent-browser runtime", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-browser-runtime-"));
    writeReleaseFixture(rootDir, { omitBrowserRuntime: true });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /embedded agent-browser CLI/,
    );
  });

  void it("release check rejects legacy Electron desktop package and scripts", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-legacy-"));
    writeReleaseFixture(rootDir, { legacyElectron: true });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /Legacy Electron Admin Desktop surface remains/,
    );
  });

  void it("release check rejects legacy Tauri BFF fixture backend", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-legacy-bff-"));
    writeReleaseFixture(rootDir, { legacyTauriBff: true });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /Legacy Tauri Desktop BFF surface remains/,
    );
  });

  void it("release check rejects Node runtime entrypoints in the embedded runtime", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-node-runtime-"));
    writeReleaseFixture(rootDir, { nodeRuntimeEntrypoint: true });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /Disallowed Node runtime entrypoint remains/,
    );
  });

  void it("release check rejects QuickJS plugin runtime metadata", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-js-fallback-"));
    writeReleaseFixture(rootDir, { jsPluginRuntime: "pi-quickjs" });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /must advertise the bundled Node plugin runtime/,
    );
  });

  void it("release check rejects Node package surfaces in the embedded runtime", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-node-package-"));
    writeReleaseFixture(rootDir, { nodeRuntimePackageSurface: true });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /Disallowed Node runtime package surface remains/,
    );
  });

  void it("release check requires the packaged macOS app to embed the Rust runtime", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-packaged-"));
    writeReleaseFixture(rootDir, { omitPackagedRuntime: true });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          platform: "darwin",
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /packaged Tauri macOS app embedded runtime/,
    );
  });

  void it("release check rejects Node runtime entrypoints in the packaged macOS runtime", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-packaged-node-"));
    writeReleaseFixture(rootDir, { packagedNodeRuntimeEntrypoint: true });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          platform: "darwin",
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /Disallowed Node runtime entrypoint remains/,
    );
  });

  void it("release check requires packaged provider transport capabilities", () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "crawclaw-tauri-packaged-providers-"));
    writeReleaseFixture(rootDir, { omitPackagedProviders: true });

    assert.throws(
      () =>
        assertCrawClawDesktopTauriReleaseInputs({
          rootDir,
          platform: "darwin",
          checkGeneratedPaths: false,
          spawnSyncImpl() {
            return { status: 0, signal: null, stdout: "", stderr: "" };
          },
        }),
      /packaged Tauri macOS app embedded runtime Rust provider transport manifest/,
    );
  });
});

function writeReleaseFixture(rootDir, options = {}) {
  const paths = resolveCrawClawDesktopTauriRuntimeStagePaths(rootDir);
  fs.mkdirSync(path.join(rootDir, "apps", "crawclaw-desktop", "src-tauri"), { recursive: true });
  fs.mkdirSync(path.join(rootDir, "apps", "crawclaw-desktop", "dist"), { recursive: true });
  fs.mkdirSync(path.join(paths.runtimeRoot, "bin"), { recursive: true });
  fs.mkdirSync(path.join(paths.runtimeRoot, "runtimes"), { recursive: true });
  fs.mkdirSync(path.join(paths.runtimeRoot, "channels"), { recursive: true });
  fs.mkdirSync(path.join(paths.runtimeRoot, "providers"), { recursive: true });
  fs.mkdirSync(path.join(paths.runtimeRoot, "plugins"), { recursive: true });
  const scripts = options.legacyElectron
    ? { "admin:desktop:build": "npm --prefix apps/crawclaw-admin-desktop run build" }
    : {};
  fs.writeFileSync(
    path.join(rootDir, "package.json"),
    JSON.stringify({ version: "2026.5.3", scripts }) + "\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(rootDir, "apps", "crawclaw-desktop", "package.json"),
    '{"version":"2026.5.3"}\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(rootDir, "apps", "crawclaw-desktop", "src-tauri", "tauri.conf.json"),
    JSON.stringify({
      productName: "CrawClaw Desktop",
      identifier: "ai.crawclaw.desktop",
      bundle: {
        resources: {
          "../.runtime/crawclaw": "runtime/crawclaw",
        },
      },
    }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(rootDir, "apps", "crawclaw-desktop", "dist", "index.html"),
    "",
    "utf8",
  );
  if (options.omit !== "binary") {
    fs.writeFileSync(paths.runtimeBinaryPath, "#!/bin/sh\nexit 0\n", "utf8");
    fs.writeFileSync(paths.gatewayBinaryPath, "#!/bin/sh\nexit 0\n", "utf8");
    fs.writeFileSync(paths.nativePluginsBinaryPath, "#!/bin/sh\nexit 0\n", "utf8");
  }
  if (options.omit !== "manifest") {
    fs.writeFileSync(
      path.join(paths.runtimeRoot, "runtimes", "manifest.json"),
      runtimeManifestJson(options),
      "utf8",
    );
  }
  if (options.omit !== "channels") {
    fs.writeFileSync(
      path.join(paths.runtimeRoot, "channels", "manifest.json"),
      channelManifestJson(),
      "utf8",
    );
  }
  if (options.omit !== "providers") {
    fs.writeFileSync(
      path.join(paths.runtimeRoot, "providers", "manifest.json"),
      providerManifestJson(),
      "utf8",
    );
  }
  if (options.omit !== "plugins") {
    fs.writeFileSync(
      path.join(paths.runtimeRoot, "plugins", "manifest.json"),
      pluginManifestJson(options),
      "utf8",
    );
  }
  writeNode24Runtime(paths.nodeRuntimeRoot);
  if (!options.omitBrowserRuntime) {
    writeEmbeddedBrowserRuntime(paths.runtimeRoot);
  }
  if (options.legacyElectron) {
    fs.mkdirSync(path.join(rootDir, "apps", "crawclaw-admin-desktop"), { recursive: true });
    fs.mkdirSync(path.join(rootDir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "scripts", "admin-desktop-release-check.mjs"), "", "utf8");
  }
  if (options.legacyTauriBff) {
    const srcDir = path.join(rootDir, "apps", "crawclaw-desktop", "src-tauri", "src");
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, "bff.rs"), "", "utf8");
    fs.writeFileSync(path.join(srcDir, "desktop_state.rs"), "", "utf8");
  }
  if (options.nodeRuntimeEntrypoint) {
    fs.writeFileSync(path.join(paths.runtimeRoot, "crawclaw.mjs"), "export {};\n", "utf8");
    fs.mkdirSync(path.join(paths.runtimeRoot, "compat"), { recursive: true });
    fs.writeFileSync(
      path.join(paths.runtimeRoot, "compat", "js-plugin-runner.mjs"),
      "export {};\n",
      "utf8",
    );
  }
  if (options.nodeRuntimePackageSurface) {
    fs.writeFileSync(path.join(paths.runtimeRoot, "package.json"), "{}\n", "utf8");
    fs.mkdirSync(path.join(paths.runtimeRoot, "node_modules", "legacy-provider"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(paths.runtimeRoot, "node_modules", "legacy-provider", "index.js"),
      "export {};\n",
      "utf8",
    );
  }
  if (!options.omitPackagedRuntime) {
    const packagedRoot = packagedMacRuntimeRoot(rootDir);
    fs.mkdirSync(path.join(packagedRoot, "bin"), { recursive: true });
    fs.mkdirSync(path.join(packagedRoot, "runtimes"), { recursive: true });
    fs.mkdirSync(path.join(packagedRoot, "channels"), { recursive: true });
    fs.mkdirSync(path.join(packagedRoot, "providers"), { recursive: true });
    fs.mkdirSync(path.join(packagedRoot, "plugins"), { recursive: true });
    fs.writeFileSync(
      path.join(packagedRoot, "bin", runtimeBinaryName()),
      "#!/bin/sh\nexit 0\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(packagedRoot, "bin", gatewayBinaryName()),
      "#!/bin/sh\nexit 0\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(packagedRoot, "bin", nativePluginsBinaryName()),
      "#!/bin/sh\nexit 0\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(packagedRoot, "runtimes", "manifest.json"),
      runtimeManifestJson(options),
      "utf8",
    );
    fs.writeFileSync(
      path.join(packagedRoot, "channels", "manifest.json"),
      channelManifestJson(),
      "utf8",
    );
    if (!options.omitPackagedProviders) {
      fs.writeFileSync(
        path.join(packagedRoot, "providers", "manifest.json"),
        providerManifestJson(),
        "utf8",
      );
    }
    fs.writeFileSync(
      path.join(packagedRoot, "plugins", "manifest.json"),
      pluginManifestJson(options),
      "utf8",
    );
    writeNode24Runtime(path.join(packagedRoot, "runtimes", "node-v24"));
    if (!options.omitBrowserRuntime) {
      writeEmbeddedBrowserRuntime(packagedRoot);
    }
    if (options.packagedNodeRuntimeEntrypoint) {
      fs.writeFileSync(path.join(packagedRoot, "crawclaw.mjs"), "export {};\n", "utf8");
    }
  }
  if (process.platform !== "win32") {
    for (const executablePath of [
      paths.runtimeBinaryPath,
      paths.gatewayBinaryPath,
      paths.nativePluginsBinaryPath,
      paths.nodeBinaryPath,
      paths.npmBinaryPath,
      path.join(packagedMacRuntimeRoot(rootDir), "bin", runtimeBinaryName()),
      path.join(packagedMacRuntimeRoot(rootDir), "bin", gatewayBinaryName()),
      path.join(packagedMacRuntimeRoot(rootDir), "bin", nativePluginsBinaryName()),
      path.join(packagedMacRuntimeRoot(rootDir), "runtimes", "node-v24", "bin", "node"),
      path.join(packagedMacRuntimeRoot(rootDir), "runtimes", "node-v24", "bin", "npm"),
    ]) {
      if (fs.existsSync(executablePath)) {
        fs.chmodSync(executablePath, 0o755);
      }
    }
  }
}

function writeRuntimeManifests(runtimeRoot, options = {}) {
  fs.mkdirSync(path.join(runtimeRoot, "runtimes"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "channels"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "providers"), { recursive: true });
  fs.mkdirSync(path.join(runtimeRoot, "plugins"), { recursive: true });
  fs.writeFileSync(
    path.join(runtimeRoot, "runtimes", "manifest.json"),
    runtimeManifestJson(options),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runtimeRoot, "channels", "manifest.json"),
    channelManifestJson(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runtimeRoot, "providers", "manifest.json"),
    providerManifestJson(),
    "utf8",
  );
  fs.writeFileSync(
    path.join(runtimeRoot, "plugins", "manifest.json"),
    pluginManifestJson(options),
    "utf8",
  );
}

function writeEmbeddedBrowserRuntime(runtimeRoot) {
  const browserRuntimeRoot = path.join(runtimeRoot, "runtimes", "browser");
  const binDir = path.join(browserRuntimeRoot, "node_modules", ".bin");
  const packageDir = path.join(browserRuntimeRoot, "node_modules", "agent-browser");
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(packageDir, { recursive: true });
  const binPath = path.join(
    binDir,
    process.platform === "win32" ? "agent-browser.cmd" : "agent-browser",
  );
  fs.writeFileSync(binPath, "#!/bin/sh\nprintf 'agent-browser 0.27.0\\n'\n", "utf8");
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    '{"name":"agent-browser","version":"0.27.0"}\n',
    "utf8",
  );
  if (process.platform !== "win32") {
    fs.chmodSync(binPath, 0o755);
  }
}

function runtimeManifestJson(options = {}) {
  return `${JSON.stringify({
    runtime: "rust-native",
    jsPluginRuntime: options.jsPluginRuntime ?? "node",
    node: { major: 24, distribution: "bundled" },
  })}\n`;
}

function runtimeBinaryName() {
  return process.platform === "win32" ? "crawclaw-runtime.exe" : "crawclaw-runtime";
}

function gatewayBinaryName() {
  return process.platform === "win32" ? "crawclaw-gateway.exe" : "crawclaw-gateway";
}

function nativePluginsBinaryName() {
  return process.platform === "win32" ? "crawclaw-native-plugins.exe" : "crawclaw-native-plugins";
}

function pluginManifestJson(options = {}) {
  return `${JSON.stringify({
    readModel: true,
    jsPluginRuntime: options.jsPluginRuntime ?? "node",
    node: { major: 24, distribution: "bundled", permissions: "full" },
  })}\n`;
}

function writeSourceNode24Runtime(rootDir) {
  const nodeRoot = path.join(rootDir, "fixtures", "node-v24");
  writeNode24Runtime(nodeRoot);
  return nodeRoot;
}

function writeNode24Runtime(nodeRoot) {
  const binDir = path.join(nodeRoot, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, "node"), "#!/bin/sh\nprintf 'v24.0.0\\n'\n", "utf8");
  fs.writeFileSync(path.join(binDir, "npm"), "#!/bin/sh\nprintf '11.0.0\\n'\n", "utf8");
  fs.mkdirSync(path.join(nodeRoot, "lib", "node_modules", "npm", "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(nodeRoot, "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    "require('../lib/cli.js')(process)\n",
    "utf8",
  );
  if (process.platform !== "win32") {
    fs.chmodSync(path.join(binDir, "node"), 0o755);
    fs.chmodSync(path.join(binDir, "npm"), 0o755);
  }
}

function packagedMacRuntimeRoot(rootDir) {
  return path.join(
    rootDir,
    "target",
    "release",
    "bundle",
    "macos",
    "CrawClaw Desktop.app",
    "Contents",
    "Resources",
    "runtime",
    "crawclaw",
  );
}

function channelManifestJson() {
  return `${JSON.stringify({
    implementation: "rust-native",
    channels: [
      { id: "ddingtalk" },
      { id: "feishu" },
      { id: "esp32" },
      { id: "qqbot" },
      { id: "weixin" },
    ],
  })}\n`;
}

function providerManifestJson() {
  const providers = [
    "amazon-bedrock",
    "anthropic",
    "anthropic-vertex",
    "azure-openai",
    "bedrock",
    "byteplus",
    "byteplus-plan",
    "chutes",
    "cloudflare-ai-gateway",
    "copilot-proxy",
    "deepseek",
    "github-copilot",
    "google",
    "google-gemini-cli",
    "huggingface",
    "kilocode",
    "kimi",
    "kimi-coding",
    "litellm",
    "microsoft-foundry",
    "minimax",
    "minimax-portal",
    "mistral",
    "modelstudio",
    "moonshot",
    "nvidia",
    "ollama",
    "openai",
    "openai-codex",
    "openai-compatible",
    "opencode",
    "opencode-go",
    "openrouter",
    "qianfan",
    "sglang",
    "synthetic",
    "together",
    "venice",
    "vercel-ai-gateway",
    "vllm",
    "volcengine",
    "volcengine-plan",
    "xai",
    "xiaomi",
    "zai",
  ];
  return `${JSON.stringify({
    providers,
    transports: providers.map((id) => ({
      id,
      transport: "openai-completions",
      capabilities: {
        streaming: true,
        toolCalling: true,
        multimodal: true,
        secretRef: {
          env: true,
          file: true,
          exec: false,
        },
      },
    })),
  })}\n`;
}
