import type { CrawClawConfig } from "../../config/config.js";
import { createPluginRegistry } from "../registry.js";

export function uniqueSortedStrings(values: readonly string[]) {
  return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

export function createPluginRegistryFixture(config = {} as CrawClawConfig) {
  return {
    config,
    registry: createPluginRegistry({
      logger: {
        info() {},
        warn() {},
        error() {},
        debug() {},
      },
    }),
  };
}
