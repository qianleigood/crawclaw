import { describe, expect, it } from "vitest";
import {
  aggregateReviewVerdict,
  parseReviewStageReport,
  REVIEW_QUALITY_AGENT_DEFINITION,
  REVIEW_SPEC_AGENT_DEFINITION,
} from "./review-agent.js";

describe("parseReviewStageReport", () => {
  it("parses a strict spec stage report", () => {
    const report = parseReviewStageReport(
      [
        "STAGE: SPEC",
        "VERDICT: PARTIAL",
        "SUMMARY: Plugin SDK boundary was checked, but channel coverage is incomplete.",
        "BLOCKING_ISSUES:",
        "- Missing Matrix channel regression coverage.",
        "WARNINGS:",
        "- Did not inspect docs/i18n fallout.",
        "EVIDENCE:",
        "- inspected src/plugins/loader.ts",
        "- ran pnpm test -- src/plugins/loader.test.ts",
        "RECOMMENDED_FIXES:",
        "- Add a channel-boundary regression test.",
      ].join("\n"),
      "spec",
    );

    expect(report).toEqual({
      stage: "spec",
      verdict: "PARTIAL",
      summary: "Plugin SDK boundary was checked, but channel coverage is incomplete.",
      blockingIssues: ["Missing Matrix channel regression coverage."],
      warnings: ["Did not inspect docs/i18n fallout."],
      evidence: ["inspected src/plugins/loader.ts", "ran pnpm test -- src/plugins/loader.test.ts"],
      recommendedFixes: ["Add a channel-boundary regression test."],
      valid: true,
    });
  });

  it("treats malformed reports as partial and invalid", () => {
    expect(parseReviewStageReport("SUMMARY: no verdict", "quality")).toMatchObject({
      stage: "quality",
      verdict: "PARTIAL",
      valid: false,
      warnings: expect.arrayContaining(["Review report invalid or incomplete."]),
    });
  });
});

describe("aggregateReviewVerdict", () => {
  it.each([
    ["FAIL", undefined, "REVIEW_FAIL", ["quality"]],
    ["PARTIAL", "PASS", "REVIEW_PARTIAL", []],
    ["PARTIAL", "PARTIAL", "REVIEW_PARTIAL", []],
    ["PARTIAL", "FAIL", "REVIEW_FAIL", []],
    ["PASS", "PASS", "REVIEW_PASS", []],
    ["PASS", "PARTIAL", "REVIEW_PARTIAL", []],
    ["PASS", "FAIL", "REVIEW_FAIL", []],
  ] as const)(
    "aggregates spec %s and quality %s into %s",
    (specVerdict, qualityVerdict, expectedVerdict, skippedStages) => {
      const spec = {
        stage: "spec" as const,
        verdict: specVerdict,
        summary: "spec",
        blockingIssues: [],
        warnings: [],
        evidence: [],
        recommendedFixes: [],
        valid: true,
      };
      const quality = qualityVerdict
        ? {
            stage: "quality" as const,
            verdict: qualityVerdict,
            summary: "quality",
            blockingIssues: [],
            warnings: [],
            evidence: [],
            recommendedFixes: [],
            valid: true,
          }
        : undefined;

      expect(aggregateReviewVerdict({ spec, quality })).toMatchObject({
        verdict: expectedVerdict,
        skippedStages,
      });
    },
  );

  it("prevents invalid stage reports from becoming REVIEW_PASS", () => {
    const result = aggregateReviewVerdict({
      spec: {
        stage: "spec",
        verdict: "PASS",
        summary: "spec",
        blockingIssues: [],
        warnings: ["Review report invalid or incomplete."],
        evidence: [],
        recommendedFixes: [],
        valid: false,
      },
      quality: {
        stage: "quality",
        verdict: "PASS",
        summary: "quality",
        blockingIssues: [],
        warnings: [],
        evidence: [],
        recommendedFixes: [],
        valid: true,
      },
    });

    expect(result.verdict).toBe("REVIEW_PARTIAL");
  });
});

describe("review special agent definitions", () => {
  it("defines isolated read-only stage agents", () => {
    expect(REVIEW_SPEC_AGENT_DEFINITION).toMatchObject({
      id: "review-spec",
      label: "review spec",
      spawnSource: "review-spec",
      executionMode: "spawned_session",
      transcriptPolicy: "isolated",
    });
    expect(REVIEW_QUALITY_AGENT_DEFINITION).toMatchObject({
      id: "review-quality",
      label: "review quality",
      spawnSource: "review-quality",
      executionMode: "spawned_session",
      transcriptPolicy: "isolated",
    });
    expect(REVIEW_SPEC_AGENT_DEFINITION.toolPolicy?.allowlist).toEqual(
      REVIEW_QUALITY_AGENT_DEFINITION.toolPolicy?.allowlist,
    );
    expect(REVIEW_SPEC_AGENT_DEFINITION.toolPolicy?.allowlist).not.toContain("review_task");
  });
});
