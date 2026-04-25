import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderRootHelpText } from "./root-help.js";

const configPluginsMock = vi.hoisted(() => ({
  value: undefined as Record<string, unknown> | undefined,
}));
const getPluginCliCommandDescriptorsMock = vi.hoisted(() => vi.fn());
const resolvePrecomputedPluginHelpDescriptorsMock = vi.hoisted(() => vi.fn());

vi.mock("./core-command-descriptors.js", () => ({
  getCoreCliCommandDescriptors: () => [
    {
      name: "status",
      description: "Show status",
      descriptionKey: "command.status.description",
      hasSubcommands: false,
    },
  ],
  localizeCoreCliCommandDescriptors: () => [
    {
      name: "status",
      description: "Show status",
      descriptionKey: "command.status.description",
      hasSubcommands: false,
    },
  ],
  getCoreCliCommandsWithSubcommands: () => [],
}));

vi.mock("./subcli-descriptors.js", () => ({
  getSubCliEntries: () => [
    {
      name: "config",
      description: "Manage config",
      descriptionKey: "command.config.description",
      hasSubcommands: true,
    },
  ],
  localizeSubCliEntries: () => [
    {
      name: "config",
      description: "Manage config",
      descriptionKey: "command.config.description",
      hasSubcommands: true,
    },
  ],
  getSubCliCommandsWithSubcommands: () => ["config"],
}));

vi.mock("../../plugins/cli-metadata.js", () => ({
  getPluginCliCommandDescriptors: getPluginCliCommandDescriptorsMock,
}));

vi.mock("../plugin-help-metadata.js", () => ({
  resolvePrecomputedPluginHelpDescriptors: resolvePrecomputedPluginHelpDescriptorsMock,
}));

describe("root help", () => {
  const cleanupDirs: string[] = [];
  const originalConfigPath = process.env.CRAWCLAW_CONFIG_PATH;

  async function writeRootHelpConfig(value: unknown) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-root-help-"));
    cleanupDirs.push(dir);
    const configPath = path.join(dir, "crawclaw.json");
    await fs.writeFile(configPath, JSON.stringify(value), "utf8");
    process.env.CRAWCLAW_CONFIG_PATH = configPath;
  }

  beforeEach(() => {
    configPluginsMock.value = undefined;
    process.env.CRAWCLAW_CONFIG_PATH = originalConfigPath;
    getPluginCliCommandDescriptorsMock.mockReset();
    getPluginCliCommandDescriptorsMock.mockResolvedValue([
      {
        name: "matrix",
        description: "Matrix channel utilities",
        hasSubcommands: true,
      },
    ]);
    resolvePrecomputedPluginHelpDescriptorsMock.mockReset();
    resolvePrecomputedPluginHelpDescriptorsMock.mockReturnValue([]);
  });

  afterEach(async () => {
    process.env.CRAWCLAW_CONFIG_PATH = originalConfigPath;
    await Promise.all(
      cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("does not load plugin CLI descriptors for default root help", async () => {
    const text = await renderRootHelpText();

    expect(text).toContain("status");
    expect(text).toContain("config");
    expect(text).not.toContain("matrix");
    expect(getPluginCliCommandDescriptorsMock).not.toHaveBeenCalled();
  });

  it("includes plugin CLI descriptors alongside core and sub-CLI commands", async () => {
    configPluginsMock.value = {
      entries: {
        matrix: {},
      },
    };
    resolvePrecomputedPluginHelpDescriptorsMock.mockReturnValue([
      {
        name: "matrix",
        description: "Matrix channel utilities",
        hasSubcommands: true,
      },
    ]);
    await writeRootHelpConfig({ plugins: configPluginsMock.value });

    const text = await renderRootHelpText();

    expect(text).toContain("status");
    expect(text).toContain("config");
    expect(text).toContain("matrix");
    expect(text).toContain("Matrix channel utilities");
    expect(resolvePrecomputedPluginHelpDescriptorsMock).toHaveBeenCalledWith(["matrix"], "en");
    expect(getPluginCliCommandDescriptorsMock).not.toHaveBeenCalled();
  });

  it("renders localized help copy when --lang zh-CN is present", async () => {
    const originalArgv = process.argv;
    process.argv = ["node", "crawclaw", "--lang", "zh-CN", "--help"];
    try {
      const text = await renderRootHelpText();
      expect(text).toContain("示例：");
      expect(text).toContain("文档：");
    } finally {
      process.argv = originalArgv;
    }
  });

  it("renders localized help copy from cli.language config", async () => {
    await writeRootHelpConfig({ cli: { language: "zh-CN" } });

    const text = await renderRootHelpText();
    expect(text).toContain("示例：");
    expect(text).toContain("文档：");
  });
});
