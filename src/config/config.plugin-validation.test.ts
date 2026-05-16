import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clearPluginManifestRegistryCache } from "../plugins/manifest-registry.js";
import { validateConfigObjectWithPlugins } from "./config.js";

vi.unmock("../version.js");

async function chmodSafeDir(dir: string) {
  if (process.platform === "win32") {
    return;
  }
  await fs.chmod(dir, 0o755);
}

async function mkdirSafe(dir: string) {
  await fs.mkdir(dir, { recursive: true });
  await chmodSafeDir(dir);
}

async function writePluginFixture(params: {
  dir: string;
  id: string;
  schema: Record<string, unknown>;
}) {
  await mkdirSafe(params.dir);
  await fs.writeFile(
    path.join(params.dir, "index.js"),
    `export default { id: "${params.id}" };`,
    "utf-8",
  );
  const manifest: Record<string, unknown> = {
    id: params.id,
    configSchema: params.schema,
  };
  await fs.writeFile(
    path.join(params.dir, "crawclaw.plugin.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8",
  );
}

async function writeBundleFixture(params: {
  dir: string;
  format: "codex" | "claude";
  name: string;
}) {
  await mkdirSafe(params.dir);
  const manifestDir = path.join(
    params.dir,
    params.format === "codex" ? ".codex-plugin" : ".claude-plugin",
  );
  await mkdirSafe(manifestDir);
  await fs.writeFile(
    path.join(manifestDir, "plugin.json"),
    JSON.stringify({ name: params.name }, null, 2),
    "utf-8",
  );
}

async function writeManifestlessClaudeBundleFixture(params: { dir: string }) {
  await mkdirSafe(params.dir);
  await mkdirSafe(path.join(params.dir, "commands"));
  await fs.writeFile(
    path.join(params.dir, "commands", "review.md"),
    "---\ndescription: fixture\n---\n",
    "utf-8",
  );
  await fs.writeFile(path.join(params.dir, "settings.json"), '{"hideThinkingBlock":true}', "utf-8");
}

function expectRemovedPluginWarnings(
  result: { ok: boolean; warnings?: Array<{ path: string; message: string }> },
  removedId: string,
  removedLabel: string,
) {
  expect(result.ok).toBe(true);
  if (result.ok) {
    const message = `plugin removed: ${removedLabel} (stale config entry ignored; remove it from plugins config)`;
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        { path: `plugins.entries.${removedId}`, message },
        { path: "plugins.allow", message },
        { path: "plugins.deny", message },
      ]),
    );
  }
}

describe("config plugin validation", () => {
  let fixtureRoot = "";
  let suiteHome = "";
  let badPluginDir = "";
  let enumPluginDir = "";
  let googleOverridePluginDir = "";
  let bundlePluginDir = "";
  let manifestlessClaudeBundleDir = "";
  const suiteEnv = () =>
    ({
      HOME: suiteHome,
      CRAWCLAW_HOME: undefined,
      CRAWCLAW_STATE_DIR: path.join(suiteHome, ".crawclaw"),
      CRAWCLAW_PLUGIN_MANIFEST_CACHE_MS: "10000",
      CRAWCLAW_DISABLE_PLUGIN_DISCOVERY_CACHE: "1",
      CRAWCLAW_BUNDLED_PLUGINS_DIR: undefined,
      CRAWCLAW_VERSION: undefined,
      VITEST: "true",
    }) satisfies NodeJS.ProcessEnv;

  const validateInSuite = (raw: unknown) =>
    validateConfigObjectWithPlugins(raw, { env: suiteEnv() });

  const validateRemovedPluginConfig = (removedId: string) =>
    validateInSuite({
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: false,
        entries: { [removedId]: { enabled: true } },
        allow: [removedId],
        deny: [removedId],
        slots: { memory: removedId },
      },
    });

  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-config-plugin-validation-"));
    await chmodSafeDir(fixtureRoot);
    suiteHome = path.join(fixtureRoot, "home");
    await mkdirSafe(suiteHome);
    badPluginDir = path.join(suiteHome, "bad-plugin");
    enumPluginDir = path.join(suiteHome, "enum-plugin");
    await writePluginFixture({
      dir: badPluginDir,
      id: "bad-plugin",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          value: { type: "boolean" },
        },
        required: ["value"],
      },
    });
    await writePluginFixture({
      dir: enumPluginDir,
      id: "enum-plugin",
      schema: {
        type: "object",
        properties: {
          fileFormat: {
            type: "string",
            enum: ["markdown", "html"],
          },
        },
        required: ["fileFormat"],
      },
    });
    googleOverridePluginDir = path.join(suiteHome, "google");
    await writePluginFixture({
      dir: googleOverridePluginDir,
      id: "google",
      schema: {
        type: "object",
        properties: {
          apiKey: { type: "string" },
        },
      },
    });
    bundlePluginDir = path.join(suiteHome, "bundle-plugin");
    await writeBundleFixture({
      dir: bundlePluginDir,
      format: "codex",
      name: "Bundle Fixture",
    });
    manifestlessClaudeBundleDir = path.join(suiteHome, "manifestless-claude-bundle");
    await writeManifestlessClaudeBundleFixture({
      dir: manifestlessClaudeBundleDir,
    });
    clearPluginManifestRegistryCache();
    // Warm the plugin manifest cache once so path-based validations can reuse
    // parsed manifests across test cases.
    validateInSuite({
      plugins: {
        enabled: false,
        load: {
          paths: [badPluginDir, bundlePluginDir, manifestlessClaudeBundleDir],
        },
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPluginManifestRegistryCache();
  });

  afterAll(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
    clearPluginManifestRegistryCache();
  });

  it("reports missing plugin refs across load paths, entries, and allowlist surfaces", async () => {
    const missingPath = path.join(suiteHome, "missing-plugin-dir");
    const res = validateInSuite({
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: false,
        load: { paths: [missingPath] },
        entries: { "missing-plugin": { enabled: true } },
        allow: ["missing-allow"],
        deny: ["missing-deny"],
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(
        res.issues.some(
          (issue) =>
            issue.path === "plugins.load.paths" && issue.message.includes("plugin path not found"),
        ),
      ).toBe(true);
      expect(res.issues).toEqual(
        expect.arrayContaining([
          { path: "plugins.deny", message: "plugin not found: missing-deny" },
        ]),
      );
      expect(res.warnings).toContainEqual({
        path: "plugins.allow",
        message:
          "plugin not found: missing-allow (stale config entry ignored; remove it from plugins config)",
      });
      expect(res.warnings).toContainEqual({
        path: "plugins.entries.missing-plugin",
        message:
          "plugin not found: missing-plugin (stale config entry ignored; remove it from plugins config)",
      });
    }
  });

  it("does not fail validation for the implicit default memory slot when plugins config is explicit", async () => {
    const res = validateConfigObjectWithPlugins(
      {
        agents: { list: [{ id: "pi" }] },
        plugins: {
          entries: { acpx: { enabled: true } },
        },
      },
      {
        env: {
          ...suiteEnv(),
          CRAWCLAW_BUNDLED_PLUGINS_DIR: path.join(suiteHome, "missing-bundled-plugins"),
        },
      },
    );
    expect(res.ok).toBe(true);
  });

  it("warns for removed legacy plugin ids instead of failing validation", async () => {
    const removedId = "google-antigravity-auth";
    const res = validateRemovedPluginConfig(removedId);
    expectRemovedPluginWarnings(res, removedId, removedId);
  });

  it("warns for removed google gemini auth plugin ids instead of failing validation", async () => {
    const removedId = "google-gemini-cli-auth";
    const res = validateRemovedPluginConfig(removedId);
    expectRemovedPluginWarnings(res, removedId, removedId);
  });

  it("does not auto-allow config-loaded overrides of bundled web search plugin ids", async () => {
    const res = validateInSuite({
      plugins: {
        allow: ["weixin", "legacy-memory"],
        load: {
          paths: [googleOverridePluginDir],
        },
        entries: {
          google: {
            config: {
              apiKey: "test-google-key",
            },
          },
        },
      },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.warnings).toContainEqual({
      path: "plugins.entries.google",
      message: "plugin disabled (not in allowlist) but config is present",
    });
  });

  it("surfaces plugin config diagnostics", async () => {
    const res = validateInSuite({
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: true,
        load: { paths: [badPluginDir] },
        entries: { "bad-plugin": { config: { value: "nope" } } },
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const hasIssue = res.issues.some(
        (issue) =>
          issue.path.startsWith("plugins.entries.bad-plugin.config") &&
          issue.message.includes("invalid config"),
      );
      expect(hasIssue).toBe(true);
    }
  });

  it("does not require native config schemas for enabled bundle plugins", async () => {
    const res = validateInSuite({
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: true,
        load: { paths: [bundlePluginDir] },
        entries: { "bundle-fixture": { enabled: true } },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("accepts enabled manifestless Claude bundles without a native schema", async () => {
    const res = validateInSuite({
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: true,
        load: { paths: [manifestlessClaudeBundleDir] },
        entries: { "manifestless-claude-bundle": { enabled: true } },
      },
    });

    expect(res.ok).toBe(true);
  });

  it("surfaces allowed enum values for plugin config diagnostics", async () => {
    const res = validateInSuite({
      agents: { list: [{ id: "pi" }] },
      plugins: {
        enabled: true,
        load: { paths: [enumPluginDir] },
        entries: { "enum-plugin": { config: { fileFormat: "txt" } } },
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      const issue = res.issues.find(
        (entry) => entry.path === "plugins.entries.enum-plugin.config.fileFormat",
      );
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('allowed: "markdown", "html"');
      expect(issue?.allowedValues).toEqual(["markdown", "html"]);
      expect(issue?.allowedValuesHiddenCount).toBe(0);
    }
  });

  it("accepts known plugin ids and valid heartbeat enums", async () => {
    const res = validateInSuite({
      agents: {
        defaults: { heartbeat: { target: "last", directPolicy: "block" } },
        list: [{ id: "pi", heartbeat: { directPolicy: "allow" } }],
      },
      plugins: { enabled: false, entries: { qqbot: { enabled: true } } },
    });
    expect(res.ok).toBe(true);
  });

  it("accepts custom heartbeat targets", async () => {
    const res = validateInSuite({
      agents: {
        defaults: { heartbeat: { target: "not-a-channel" } },
        list: [{ id: "pi" }],
      },
    });
    expect(res.ok).toBe(true);
  });

  it("rejects invalid heartbeat directPolicy values", async () => {
    const res = validateInSuite({
      agents: {
        defaults: { heartbeat: { directPolicy: "maybe" } },
        list: [{ id: "pi" }],
      },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(
        res.issues.some((issue) => issue.path === "agents.defaults.heartbeat.directPolicy"),
      ).toBe(true);
    }
  });
});
