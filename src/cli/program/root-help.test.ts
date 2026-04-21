import { describe, expect, it, vi } from "vitest";
import { renderRootHelpText } from "./root-help.js";

vi.mock("./core-command-descriptors.js", () => ({
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

vi.mock("../../plugins/cli.js", () => ({
  getPluginCliCommandDescriptors: async () => [
    {
      name: "matrix",
      description: "Matrix channel utilities",
      hasSubcommands: true,
    },
  ],
}));

describe("root help", () => {
  it("includes plugin CLI descriptors alongside core and sub-CLI commands", async () => {
    const text = await renderRootHelpText();

    expect(text).toContain("status");
    expect(text).toContain("config");
    expect(text).toContain("matrix");
    expect(text).toContain("Matrix channel utilities");
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
});
