import { describe, expect, it } from "vitest";
import tsdownConfig from "../../tsdown.config.ts";

type TsdownConfigEntry = {
  deps?: {
    neverBundle?: string[];
  };
  entry?: Record<string, string> | string[];
  outDir?: string;
};

function asConfigArray(config: unknown): TsdownConfigEntry[] {
  return Array.isArray(config) ? (config as TsdownConfigEntry[]) : [config as TsdownConfigEntry];
}

function entryKeys(config: TsdownConfigEntry): string[] {
  if (!config.entry || Array.isArray(config.entry)) {
    return [];
  }
  return Object.keys(config.entry);
}

describe("tsdown config", () => {
  it("keeps core and bundled hooks in one dist graph", () => {
    const configs = asConfigArray(tsdownConfig);
    const distGraphs = configs.filter((config) => {
      const keys = entryKeys(config);
      return (
        keys.includes("agents/auth-profiles.runtime") || keys.includes("bundled/boot-md/handler")
      );
    });

    expect(distGraphs).toHaveLength(1);
    expect(entryKeys(distGraphs[0])).toEqual(
      expect.arrayContaining([
        "agents/auth-profiles.runtime",
        "agents/pi-model-discovery-runtime",
        "control/status.summary.runtime",
        "bundled/boot-md/handler",
      ]),
    );
    expect(entryKeys(distGraphs[0])).not.toContain("index");
  });

  it("does not emit bundled hooks from a separate dist graph", () => {
    const configs = asConfigArray(tsdownConfig);

    expect(
      configs.some((config) =>
        Array.isArray(config.entry)
          ? config.entry.some((entry) => entry.includes("src/hooks/"))
          : false,
      ),
    ).toBe(false);
  });

  it("externalizes non-bundleable runtime dependencies", () => {
    const configs = asConfigArray(tsdownConfig);
    const unifiedGraph = configs.find((config) =>
      entryKeys(config).includes("bundled/boot-md/handler"),
    );

    expect(unifiedGraph?.deps?.neverBundle).toEqual(expect.arrayContaining(["@lancedb/lancedb"]));
  });
});
