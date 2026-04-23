import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverDynamicSkillDirsFromPaths,
  discoverDynamicSkillDirsFromToolCall,
} from "./discover-from-paths.js";

const tempDirs: string[] = [];

describe("discoverDynamicSkillDirsFromPaths", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => await fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("discovers ancestor skills directories from real workspace paths", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-skill-paths-"));
    tempDirs.push(workspaceDir);
    await fs.mkdir(path.join(workspaceDir, "apps", "alpha", "src"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "apps", "alpha", "skills", "nested-skill"), {
      recursive: true,
    });
    await fs.writeFile(path.join(workspaceDir, "apps", "alpha", "src", "index.ts"), "export {};\n");
    await fs.writeFile(
      path.join(workspaceDir, "apps", "alpha", "skills", "nested-skill", "SKILL.md"),
      "---\nname: nested-skill\ndescription: nested\n---\n",
    );

    expect(
      discoverDynamicSkillDirsFromPaths({
        workspaceDir,
        paths: [path.join(workspaceDir, "apps", "alpha", "src", "index.ts")],
      }),
    ).toEqual([path.join(workspaceDir, "apps", "alpha", "skills")]);
  });

  it("extracts file tool paths from real tool calls", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-skill-tool-paths-"));
    tempDirs.push(workspaceDir);
    await fs.mkdir(path.join(workspaceDir, "apps", "alpha", "src"), { recursive: true });
    await fs.mkdir(path.join(workspaceDir, "apps", "alpha", "skills", "nested-skill"), {
      recursive: true,
    });
    await fs.writeFile(path.join(workspaceDir, "apps", "alpha", "src", "index.ts"), "export {};\n");
    await fs.writeFile(
      path.join(workspaceDir, "apps", "alpha", "skills", "nested-skill", "SKILL.md"),
      "---\nname: nested-skill\ndescription: nested\n---\n",
    );

    expect(
      discoverDynamicSkillDirsFromToolCall({
        workspaceDir,
        toolName: "read",
        toolParams: {
          path: "apps/alpha/src/index.ts",
        },
      }),
    ).toEqual([path.join(workspaceDir, "apps", "alpha", "skills")]);
  });
});
