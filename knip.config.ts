const BUNDLED_PLUGIN_ROOT_DIR = "extensions";

function bundledPluginFile(pluginId: string, relativePath: string, suffix = ""): string {
  return `${BUNDLED_PLUGIN_ROOT_DIR}/${pluginId}/${relativePath}${suffix}`;
}

const rootEntries = [
  "src/infra/warning-filter.ts!",
  bundledPluginFile("telegram", "src/audit.ts", "!"),
  bundledPluginFile("telegram", "src/token.ts", "!"),
  "src/internal-plugin-helpers/*.ts!",
] as const;

const config = {
  ignoreFiles: [
    "scripts/**",
    "**/test-fixtures/**",
    "**/live-*.ts",
    "**/test-*.ts",
    "**/*test-fixtures.ts",
    "**/*mocks.ts",
    "**/*.e2e-mocks.ts",
    "**/*.e2e-*.ts",
    "**/*.harness.ts",
    "**/*.job-fixtures.ts",
    "**/*.mock-harness.ts",
    "**/*.suite-helpers.ts",
    "**/*.test-setup.ts",
    "**/job-fixtures.ts",
    "**/*test-mocks.ts",
    "**/*test-runtime*.ts",
    "**/*.mock-setup.ts",
    "**/*.cases.ts",
    "**/*.e2e-harness.ts",
    "**/*.fixture.ts",
    "**/*.fixtures.ts",
    "**/*.mocks.ts",
    "**/*.mocks.shared.ts",
    "**/*.test-runtime.ts",
    "**/*.testkit.ts",
    "**/*.test-fixtures.ts",
    "**/*.test-mocks.ts",
    "src/gateway/live-image-probe.ts",
    "src/secrets/credential-matrix.ts",
    "src/agents/tool-policy.conformance.ts",
    "src/auto-reply/reply/audio-tags.ts",
    "src/gateway/live-tool-probe-utils.ts",
    "src/shared/text/assistant-visible-text.ts",
    bundledPluginFile("telegram", "src/bot/reply-threading.ts"),
    bundledPluginFile("telegram", "src/draft-chunking.ts"),
    bundledPluginFile("msteams", "src/conversation-store-memory.ts"),
    bundledPluginFile("msteams", "src/polls-store-memory.ts"),
    bundledPluginFile("voice-call", "src/providers/index.ts"),
    bundledPluginFile("voice-call", "src/providers/tts-openai.ts"),
  ],
  workspaces: {
    ".": {
      entry: rootEntries,
      project: [
        "src/**/*.ts!",
        "scripts/**/*.{js,mjs,cjs,ts,mts,cts}!",
        "*.config.{js,mjs,cjs,ts,mts,cts}!",
        "*.mjs!",
      ],
    },
    ui: {
      entry: ["index.html!", "src/main.ts!", "vite.config.ts!"],
      project: ["src/**/*.{ts,tsx}!"],
    },
    "packages/*": {
      entry: ["index.js!", "scripts/postinstall.js!"],
      project: ["index.js!", "scripts/**/*.js!"],
    },
    [`${BUNDLED_PLUGIN_ROOT_DIR}/*`]: {
      entry: ["index.ts!"],
      project: ["index.ts!", "src/**/*.ts!"],
      ignoreDependencies: ["crawclaw"],
    },
  },
} as const;

export default config;
