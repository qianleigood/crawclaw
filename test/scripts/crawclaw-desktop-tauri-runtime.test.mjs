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
    fs.mkdirSync(paths.runtimeRoot, { recursive: true });
    fs.writeFileSync(path.join(paths.runtimeRoot, "stale.txt"), "stale\n", "utf8");

    const calls = [];
    stageCrawClawDesktopTauriRuntime({
      rootDir,
      env: { PATH: "/usr/bin" },
      runCommand({ cwd, command, args, env }) {
        calls.push({ cwd, command, args, env });
        if (command === "cargo" && args.includes("build")) {
          const targetDir = path.join(rootDir, "target", "release");
          fs.mkdirSync(targetDir, { recursive: true });
          fs.writeFileSync(paths.sourceRuntimeBinaryPath, "#!/bin/sh\nexit 0\n", "utf8");
        }
        if (command === "cargo" && args.includes("run")) {
          fs.mkdirSync(path.join(paths.runtimeRoot, "runtimes"), { recursive: true });
          fs.mkdirSync(path.join(paths.runtimeRoot, "channels"), { recursive: true });
          fs.mkdirSync(path.join(paths.runtimeRoot, "providers"), { recursive: true });
          fs.writeFileSync(
            path.join(paths.runtimeRoot, "runtimes", "manifest.json"),
            "{}\n",
            "utf8",
          );
          fs.writeFileSync(
            path.join(paths.runtimeRoot, "channels", "manifest.json"),
            channelManifestJson(),
            "utf8",
          );
          fs.writeFileSync(
            path.join(paths.runtimeRoot, "providers", "manifest.json"),
            providerManifestJson(),
            "utf8",
          );
        }
        return { status: 0, signal: null, stdout: "", stderr: "" };
      },
    });

    assert.deepEqual(
      calls.map((call) => ({ cwd: call.cwd, command: call.command, args: call.args })),
      [
        { cwd: rootDir, command: "pnpm", args: ["build"] },
        {
          cwd: rootDir,
          command: "cargo",
          args: ["build", "-p", "crawclaw-cli", "--release"],
        },
        {
          cwd: rootDir,
          command: "cargo",
          args: [
            "run",
            "-p",
            "crawclaw-cli",
            "--",
            "runtime",
            "stage",
            "--output",
            paths.runtimeRoot,
          ],
        },
      ],
    );
    assert.equal(calls.at(-1).env.CRAWCLAW_STATE_DIR, paths.runtimeRoot);
    assert.equal(
      calls.at(-1).env.CRAWCLAW_PLUGIN_RUNTIMES_DIR,
      path.join(paths.runtimeRoot, "runtimes"),
    );
    assert.equal(calls.at(-1).env.CRAWCLAW_RUNTIME_INSTALL_PROFILE, "desktop-core");
    assert.equal(fs.existsSync(path.join(paths.runtimeRoot, "stale.txt")), false);
    assert.equal(fs.existsSync(paths.runtimeBinaryPath), true);
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
    assert.ok(argv.some((args) => args.includes("gateway --help")));
    assert.ok(argv.some((args) => args.includes("desktop-runtime status --json")));
    assert.ok(argv.some((args) => args.includes("channels list --json")));
    assert.ok(argv.every((args) => !args.includes("desktop-api snapshot --json")));
  });

  void it("release check rejects missing runtime release inputs", () => {
    const cases = [
      ["binary", /embedded Rust runtime binary/],
      ["manifest", /embedded managed plugin runtime manifest/],
      ["channels", /embedded Rust channel manifest/],
      ["providers", /embedded Rust provider transport manifest/],
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
  }
  if (options.omit !== "manifest") {
    fs.writeFileSync(path.join(paths.runtimeRoot, "runtimes", "manifest.json"), "{}\n", "utf8");
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
  if (!options.omitPackagedRuntime) {
    const packagedRoot = packagedMacRuntimeRoot(rootDir);
    fs.mkdirSync(path.join(packagedRoot, "bin"), { recursive: true });
    fs.mkdirSync(path.join(packagedRoot, "runtimes"), { recursive: true });
    fs.mkdirSync(path.join(packagedRoot, "channels"), { recursive: true });
    fs.mkdirSync(path.join(packagedRoot, "providers"), { recursive: true });
    fs.writeFileSync(
      path.join(packagedRoot, "bin", process.platform === "win32" ? "crawclaw.exe" : "crawclaw"),
      "#!/bin/sh\nexit 0\n",
      "utf8",
    );
    fs.writeFileSync(path.join(packagedRoot, "runtimes", "manifest.json"), "{}\n", "utf8");
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
    if (options.packagedNodeRuntimeEntrypoint) {
      fs.writeFileSync(path.join(packagedRoot, "crawclaw.mjs"), "export {};\n", "utf8");
    }
  }
  if (process.platform !== "win32") {
    for (const executablePath of [
      paths.runtimeBinaryPath,
      path.join(packagedMacRuntimeRoot(rootDir), "bin", "crawclaw"),
    ]) {
      if (fs.existsSync(executablePath)) {
        fs.chmodSync(executablePath, 0o755);
      }
    }
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
  return `${JSON.stringify({
    providers: ["openai"],
    transports: [
      {
        id: "openai",
        transport: "openai-responses",
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
      },
    ],
  })}\n`;
}
