import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";

const runCommandWithTimeoutMock = vi.hoisted(() => vi.fn());
let listMarketplacePlugins: typeof import("./marketplace.js").listMarketplacePlugins;
let resolveMarketplaceInstallShortcut: typeof import("./marketplace.js").resolveMarketplaceInstallShortcut;

vi.mock("../process/exec.js", () => ({
  runCommandWithTimeout: (...args: unknown[]) => runCommandWithTimeoutMock(...args),
}));

beforeAll(async () => {
  ({ listMarketplacePlugins, resolveMarketplaceInstallShortcut } =
    await import("./marketplace.js"));
});

afterEach(() => {
  runCommandWithTimeoutMock.mockReset();
});

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-marketplace-test-"));
  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function writeMarketplaceManifest(rootDir: string, manifest: unknown): Promise<string> {
  const manifestPath = path.join(rootDir, ".claude-plugin", "marketplace.json");
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  return manifestPath;
}

async function writeRemoteMarketplaceFixture(params: {
  repoDir: string;
  manifest: unknown;
  pluginDir?: string;
}) {
  await fs.mkdir(path.join(params.repoDir, ".claude-plugin"), { recursive: true });
  if (params.pluginDir) {
    await fs.mkdir(path.join(params.repoDir, params.pluginDir), { recursive: true });
  }
  await fs.writeFile(
    path.join(params.repoDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify(params.manifest),
  );
}

function mockRemoteMarketplaceClone(params: { manifest: unknown; pluginDir?: string }) {
  runCommandWithTimeoutMock.mockImplementationOnce(async (argv: string[]) => {
    const repoDir = argv.at(-1);
    expect(typeof repoDir).toBe("string");
    await writeRemoteMarketplaceFixture({
      repoDir: repoDir as string,
      manifest: params.manifest,
      ...(params.pluginDir ? { pluginDir: params.pluginDir } : {}),
    });
    return { code: 0, stdout: "", stderr: "", killed: false };
  });
}

async function expectRemoteMarketplaceError(params: { manifest: unknown; expectedError: string }) {
  mockRemoteMarketplaceClone({ manifest: params.manifest });

  const result = await listMarketplacePlugins({ marketplace: "owner/repo" });

  expect(result).toEqual({
    ok: false,
    error: params.expectedError,
  });
  expect(runCommandWithTimeoutMock).toHaveBeenCalledTimes(1);
}

function expectMarketplaceManifestListing(
  result: Awaited<ReturnType<typeof import("./marketplace.js").listMarketplacePlugins>>,
) {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error("expected marketplace listing to succeed");
  }
  expect(result.sourceLabel.replaceAll("\\", "/")).toContain(".claude-plugin/marketplace.json");
  expect(result.manifest).toEqual({
    name: "Example Marketplace",
    version: "1.0.0",
    plugins: [
      {
        name: "frontend-design",
        version: "0.1.0",
        description: "Design system bundle",
        source: { kind: "path", path: "./plugins/frontend-design" },
      },
    ],
  });
}

describe("marketplace plugins", () => {
  it("lists plugins from a local marketplace root", async () => {
    await withTempDir(async (rootDir) => {
      await writeMarketplaceManifest(rootDir, {
        name: "Example Marketplace",
        version: "1.0.0",
        plugins: [
          {
            name: "frontend-design",
            version: "0.1.0",
            description: "Design system bundle",
            source: "./plugins/frontend-design",
          },
        ],
      });

      expectMarketplaceManifestListing(await listMarketplacePlugins({ marketplace: rootDir }));
    });
  });

  it("resolves Claude-style plugin@marketplace shortcuts from known_marketplaces.json", async () => {
    await withTempDir(async (homeDir) => {
      const openClawHome = path.join(homeDir, "crawclaw-home");
      await fs.mkdir(path.join(homeDir, ".claude", "plugins"), { recursive: true });
      await fs.mkdir(openClawHome, { recursive: true });
      await fs.writeFile(
        path.join(homeDir, ".claude", "plugins", "known_marketplaces.json"),
        JSON.stringify({
          "claude-plugins-official": {
            source: {
              source: "github",
              repo: "anthropics/claude-plugins-official",
            },
            installLocation: path.join(homeDir, ".claude", "plugins", "marketplaces", "official"),
          },
        }),
      );

      await withEnvAsync({ HOME: homeDir }, async () => {
        await expect(
          resolveMarketplaceInstallShortcut("frontend-design@claude-plugins-official"),
        ).resolves.toEqual({
          ok: true,
          plugin: "frontend-design",
          marketplaceName: "claude-plugins-official",
          marketplaceSource: "claude-plugins-official",
        });
      });
    });
  });

  it("lists remote marketplace plugins from relative paths inside the cloned repo", async () => {
    mockRemoteMarketplaceClone({
      pluginDir: "plugins/frontend-design",
      manifest: {
        name: "Example Marketplace",
        version: "1.0.0",
        plugins: [
          {
            name: "frontend-design",
            version: "0.1.0",
            description: "Design system bundle",
            source: "./plugins/frontend-design",
          },
        ],
      },
    });

    const result = await listMarketplacePlugins({ marketplace: "owner/repo" });

    expect(result.ok).toBe(true);
    expect(runCommandWithTimeoutMock).toHaveBeenCalledWith(
      ["git", "clone", "--depth", "1", "https://github.com/owner/repo.git", expect.any(String)],
      { timeoutMs: 120_000 },
    );
  });

  it.each([
    {
      name: "rejects remote marketplace git plugin sources",
      manifest: {
        plugins: [
          {
            name: "frontend-design",
            source: {
              type: "git",
              url: "https://github.com/evil/plugin.git",
            },
          },
        ],
      },
      expectedError:
        'invalid marketplace entry "frontend-design" in owner/repo: ' +
        "remote marketplaces may not use git plugin sources",
    },
    {
      name: "rejects remote marketplace absolute plugin paths",
      manifest: {
        plugins: [
          {
            name: "frontend-design",
            source: {
              type: "path",
              path: "/tmp/frontend-design",
            },
          },
        ],
      },
      expectedError:
        'invalid marketplace entry "frontend-design" in owner/repo: ' +
        "remote marketplaces may only use relative plugin paths",
    },
    {
      name: "rejects remote marketplace HTTP plugin paths",
      manifest: {
        plugins: [
          {
            name: "frontend-design",
            source: {
              type: "path",
              path: "https://evil.example/plugin.tgz",
            },
          },
        ],
      },
      expectedError:
        'invalid marketplace entry "frontend-design" in owner/repo: ' +
        "remote marketplaces may not use HTTP(S) plugin paths",
    },
  ] as const)("$name", async ({ manifest, expectedError }) => {
    await expectRemoteMarketplaceError({ manifest, expectedError });
  });
});
