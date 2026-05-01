import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateEntryMetadataRequirements,
  evaluateEntryMetadataRequirementsForCurrentPlatform,
  evaluateEntryRequirementsForCurrentPlatform,
} from "./entry-status.js";

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

afterEach(() => {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, "platform", originalPlatformDescriptor);
  }
});

describe("shared/entry-status", () => {
  it("combines metadata presentation fields with evaluated requirements", () => {
    const result = evaluateEntryMetadataRequirements({
      always: false,
      metadata: {
        emoji: "🦀",
        homepage: "https://docs.crawclaw.ai",
        requires: {
          bins: ["bun"],
          anyBins: ["ffmpeg", "sox"],
          env: ["CRAWCLAW_TOKEN"],
          config: ["gateway.bind"],
        },
        os: ["darwin"],
        arch: ["arm64"],
      },
      frontmatter: {
        emoji: "🙂",
        homepage: "https://docs.crawclaw.ai",
      },
      hasLocalBin: (bin) => bin === "bun",
      localPlatform: "linux",
      localArch: "x64",
      remote: {
        hasAnyBin: (bins) => bins.includes("sox"),
      },
      isEnvSatisfied: () => false,
      isConfigSatisfied: (path) => path === "gateway.bind",
    });

    expect(result).toEqual({
      emoji: "🦀",
      homepage: "https://docs.crawclaw.ai",
      required: {
        bins: ["bun"],
        anyBins: ["ffmpeg", "sox"],
        env: ["CRAWCLAW_TOKEN"],
        config: ["gateway.bind"],
        os: ["darwin"],
        arch: ["arm64"],
      },
      missing: {
        bins: [],
        anyBins: [],
        env: ["CRAWCLAW_TOKEN"],
        config: [],
        os: ["darwin"],
        arch: ["arm64"],
      },
      requirementsSatisfied: false,
      configChecks: [{ path: "gateway.bind", satisfied: true }],
    });
  });

  it("uses process.platform in the current-platform wrapper", () => {
    setPlatform("darwin");

    const result = evaluateEntryMetadataRequirementsForCurrentPlatform({
      always: false,
      metadata: {
        os: ["darwin"],
      },
      hasLocalBin: () => false,
      isEnvSatisfied: () => true,
      isConfigSatisfied: () => true,
    });

    expect(result.requirementsSatisfied).toBe(true);
    expect(result.missing.os).toEqual([]);
    expect(result.missing.arch).toEqual([]);
  });

  it("pulls metadata and frontmatter from entry objects in the entry wrapper", () => {
    setPlatform("linux");

    const result = evaluateEntryRequirementsForCurrentPlatform({
      always: true,
      entry: {
        metadata: {
          requires: {
            bins: ["missing-bin"],
          },
        },
        frontmatter: {
          website: " https://docs.crawclaw.ai ",
          emoji: "🙂",
        },
      },
      hasLocalBin: () => false,
      isEnvSatisfied: () => false,
      isConfigSatisfied: () => false,
    });

    expect(result).toEqual({
      emoji: "🙂",
      homepage: "https://docs.crawclaw.ai",
      required: {
        bins: ["missing-bin"],
        anyBins: [],
        env: [],
        config: [],
        os: [],
        arch: [],
      },
      missing: {
        bins: [],
        anyBins: [],
        env: [],
        config: [],
        os: [],
        arch: [],
      },
      requirementsSatisfied: true,
      configChecks: [],
    });
  });

  it("returns empty requirements when metadata and frontmatter are missing", () => {
    const result = evaluateEntryMetadataRequirements({
      always: false,
      hasLocalBin: () => false,
      localPlatform: "linux",
      localArch: "x64",
      isEnvSatisfied: () => false,
      isConfigSatisfied: () => false,
    });

    expect(result).toEqual({
      required: {
        bins: [],
        anyBins: [],
        env: [],
        config: [],
        os: [],
        arch: [],
      },
      missing: {
        bins: [],
        anyBins: [],
        env: [],
        config: [],
        os: [],
        arch: [],
      },
      requirementsSatisfied: true,
      configChecks: [],
    });
  });
});
