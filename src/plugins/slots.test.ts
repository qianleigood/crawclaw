import { describe, expect, it } from "vitest";
import type { CrawClawConfig } from "../config/config.js";
import {
  applyExclusiveSlotSelection,
  hasKind,
  kindsEqual,
  normalizeKinds,
  slotKeysForPluginKind,
} from "./slots.js";
import type { PluginKind } from "./types.js";

describe("applyExclusiveSlotSelection", () => {
  const createMemoryConfig = (plugins?: CrawClawConfig["plugins"]): CrawClawConfig => ({
    plugins: {
      ...plugins,
      entries: {
        ...plugins?.entries,
        memory: {
          enabled: true,
          ...plugins?.entries?.memory,
        },
      },
    },
  });

  const runMemorySelection = (config: CrawClawConfig, selectedId = "memory") =>
    applyExclusiveSlotSelection({
      config,
      selectedId,
      selectedKind: "memory",
      registry: {
        plugins: [
          { id: "legacy-memory", kind: "memory" },
          { id: "memory", kind: "memory" },
        ],
      },
    });

  it("selects the memory slot and disables competing memory plugins", () => {
    const result = runMemorySelection(
      createMemoryConfig({
        slots: { memory: "legacy-memory" },
        entries: { "legacy-memory": { enabled: true } },
      }),
    );

    expect(result.changed).toBe(true);
    expect(result.config.plugins?.slots?.memory).toBe("memory");
    expect(result.config.plugins?.entries?.["legacy-memory"]?.enabled).toBe(false);
    expect(result.warnings).toEqual([
      'Exclusive slot "memory" switched from "legacy-memory" to "memory".',
      'Disabled other "memory" slot plugins: legacy-memory.',
    ]);
  });

  it("uses the default memory slot owner when no slot is set", () => {
    const result = runMemorySelection(createMemoryConfig());

    expect(result.changed).toBe(true);
    expect(result.config.plugins?.slots?.memory).toBe("memory");
    expect(result.warnings).toContain('Exclusive slot "memory" switched from "none" to "memory".');
  });

  it("does nothing when the selected memory plugin already owns the slot", () => {
    const config = createMemoryConfig({
      slots: { memory: "memory" },
    });

    const result = applyExclusiveSlotSelection({
      config,
      selectedId: "memory",
      selectedKind: "memory",
      registry: {
        plugins: [{ id: "memory", kind: "memory" }],
      },
    });

    expect(result.changed).toBe(false);
    expect(result.warnings).toHaveLength(0);
    expect(result.config).toBe(config);
  });
});

describe("normalizeKinds", () => {
  it("returns empty array for undefined", () => {
    expect(normalizeKinds(undefined)).toEqual([]);
  });

  it("wraps a single kind in an array", () => {
    expect(normalizeKinds("memory")).toEqual(["memory"]);
  });

  it("preserves a memory-kind array", () => {
    expect(normalizeKinds(["memory"])).toEqual(["memory"]);
  });
});

describe("hasKind", () => {
  it("returns false for undefined kind", () => {
    expect(hasKind(undefined, "memory")).toBe(false);
  });

  it("matches a single kind string", () => {
    expect(hasKind("memory", "memory")).toBe(true);
  });

  it("matches within a kind array", () => {
    expect(hasKind(["memory"], "memory")).toBe(true);
  });
});

describe("slotKeysForPluginKind", () => {
  it("returns empty for undefined", () => {
    expect(slotKeysForPluginKind(undefined)).toEqual([]);
  });

  it("returns the memory slot for memory plugins", () => {
    expect(slotKeysForPluginKind("memory")).toEqual(["memory"]);
    expect(slotKeysForPluginKind(["memory"])).toEqual(["memory"]);
  });
});

describe("kindsEqual", () => {
  it("treats undefined as equal to undefined", () => {
    expect(kindsEqual(undefined, undefined)).toBe(true);
  });

  it("matches identical memory declarations", () => {
    expect(kindsEqual("memory", "memory")).toBe(true);
    expect(kindsEqual("memory", ["memory"])).toBe(true);
    expect(kindsEqual(["memory"], ["memory"])).toBe(true);
  });

  it("rejects mismatched lengths", () => {
    expect(kindsEqual("memory", ["memory", "memory"] as PluginKind[])).toBe(false);
  });
});
