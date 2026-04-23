import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
  type CrawClawConfig,
} from "../../config/config.js";
import * as skillsModule from "../skills.js";
import {
  clearDiscoveredSkillDirsForTest,
  recordDiscoveredSkillDirs,
} from "../skills/dynamic-discovery-state.js";

const { resolveEmbeddedRunSkillEntries } = await import("./skills-runtime.js");

describe("resolveEmbeddedRunSkillEntries", () => {
  const loadWorkspaceSkillEntriesSpy = vi.spyOn(skillsModule, "loadWorkspaceSkillEntries");

  beforeEach(() => {
    clearRuntimeConfigSnapshot();
    clearDiscoveredSkillDirsForTest();
    loadWorkspaceSkillEntriesSpy.mockReset();
    loadWorkspaceSkillEntriesSpy.mockReturnValue([]);
  });

  it("loads skill entries with current config", () => {
    const config: CrawClawConfig = {
      plugins: {
        entries: {
          diffs: { enabled: true },
        },
      },
    };

    const result = resolveEmbeddedRunSkillEntries({
      workspaceDir: "/tmp/workspace",
      config,
    });

    expect(result.skillEntries).toEqual([]);
    expect(loadWorkspaceSkillEntriesSpy).toHaveBeenCalledTimes(1);
    expect(loadWorkspaceSkillEntriesSpy).toHaveBeenCalledWith("/tmp/workspace", { config });
  });

  it("prefers the active runtime snapshot when caller config still contains SecretRefs", () => {
    const sourceConfig: CrawClawConfig = {
      skills: {
        entries: {
          diffs: {
            apiKey: {
              source: "file",
              provider: "default",
              id: "/skills/entries/diffs/apiKey",
            },
          },
        },
      },
    };
    const runtimeConfig: CrawClawConfig = {
      skills: {
        entries: {
          diffs: {
            apiKey: "resolved-key",
          },
        },
      },
    };
    setRuntimeConfigSnapshot(runtimeConfig, sourceConfig);

    resolveEmbeddedRunSkillEntries({
      workspaceDir: "/tmp/workspace",
      config: sourceConfig,
    });

    expect(loadWorkspaceSkillEntriesSpy).toHaveBeenCalledWith("/tmp/workspace", {
      config: runtimeConfig,
    });
  });

  it("does not load prompt-discovered skill dirs from the user prompt", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-dynamic-runtime-"));
    try {
      await fs.mkdir(path.join(workspaceDir, "apps", "alpha", "src"), { recursive: true });
      await fs.mkdir(path.join(workspaceDir, "apps", "alpha", "skills", "nested-skill"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(workspaceDir, "apps", "alpha", "src", "index.ts"),
        "export {};\n",
      );
      await fs.writeFile(
        path.join(workspaceDir, "apps", "alpha", "skills", "nested-skill", "SKILL.md"),
        "---\nname: nested-skill\ndescription: nested\n---\n",
      );

      const result = resolveEmbeddedRunSkillEntries({
        workspaceDir,
        config: {},
        prompt: "look at apps/alpha/src/index.ts",
      });

      expect(result.skillEntries).toEqual([]);
      expect(loadWorkspaceSkillEntriesSpy).toHaveBeenCalledWith(workspaceDir, {
        config: {},
      });
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("loads session-discovered skill dirs from prior file activity", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawclaw-dynamic-runtime-"));
    const discoveredDir = path.join(workspaceDir, "apps", "alpha", "skills");
    try {
      await fs.mkdir(path.join(discoveredDir, "nested-skill"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(discoveredDir, "nested-skill", "SKILL.md"),
        "---\nname: nested-skill\ndescription: nested\n---\n",
      );
      recordDiscoveredSkillDirs({ sessionId: "session-discovered" }, [discoveredDir]);

      const result = resolveEmbeddedRunSkillEntries({
        workspaceDir,
        config: {},
        sessionId: "session-discovered",
      });

      expect(result.skillEntries).toEqual([]);
      expect(loadWorkspaceSkillEntriesSpy).toHaveBeenCalledWith(workspaceDir, {
        config: {
          skills: {
            load: {
              extraDirs: [discoveredDir],
            },
          },
        },
      });
    } finally {
      await fs.rm(workspaceDir, { recursive: true, force: true });
    }
  });
});
