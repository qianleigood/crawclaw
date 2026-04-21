import { describe, expect, it } from "vitest";
import {
  aggregateReviewReports,
  parseReviewStageReport,
  type ReviewStageReport,
} from "./review-agent.js";

describe("review-agent", () => {
  it("parses a structured review stage report", () => {
    const report = parseReviewStageReport(
      [
        "STAGE: SPEC",
        "VERDICT: PARTIAL",
        "SUMMARY: Scope mostly matches, but docs coverage is unclear.",
        "BLOCKING_ISSUES:",
        "- Missing docs update for the new command.",
        "WARNINGS:",
        "- Did not inspect generated zh-CN output.",
        "EVIDENCE:",
        "- read docs/tools/slash-commands.md",
        "RECOMMENDED_FIXES:",
        "- Update the English command docs before translation.",
      ].join("\n"),
    );

    expect(report).toEqual({
      stage: "spec",
      verdict: "PARTIAL",
      summary: "Scope mostly matches, but docs coverage is unclear.",
      blockingIssues: ["Missing docs update for the new command."],
      warnings: ["Did not inspect generated zh-CN output."],
      evidence: ["read docs/tools/slash-commands.md"],
      recommendedFixes: ["Update the English command docs before translation."],
    });
  });

  it("keeps malformed stage reports from passing", () => {
    const report = parseReviewStageReport("SUMMARY: looked around");

    expect(report).toMatchObject({
      verdict: "PARTIAL",
      warnings: expect.arrayContaining(["Review report did not include a valid VERDICT line."]),
    });
  });

  it("short-circuits quality review when spec fails", () => {
    const spec = {
      stage: "spec",
      verdict: "FAIL",
      summary: "The implementation misses the requested command.",
      blockingIssues: ["No /review command was registered."],
      warnings: [],
      evidence: ["read src/auto-reply/commands-registry.shared.ts"],
      recommendedFixes: ["Register /review."],
    } satisfies ReviewStageReport;

    expect(aggregateReviewReports({ spec })).toMatchObject({
      verdict: "REVIEW_FAIL",
      skippedStages: ["quality"],
      blockingIssues: ["No /review command was registered."],
    });
  });

  it("never upgrades a partial spec review to review pass", () => {
    const spec = {
      stage: "spec",
      verdict: "PARTIAL",
      summary: "Spec evidence is incomplete.",
      blockingIssues: [],
      warnings: ["Manual edge case not checked."],
      evidence: ["read changed files"],
      recommendedFixes: [],
    } satisfies ReviewStageReport;
    const quality = {
      stage: "quality",
      verdict: "PASS",
      summary: "Code quality checks passed.",
      blockingIssues: [],
      warnings: [],
      evidence: ["pnpm test -- src/agents/review-agent.test.ts"],
      recommendedFixes: [],
    } satisfies ReviewStageReport;

    expect(aggregateReviewReports({ spec, quality })).toMatchObject({
      verdict: "REVIEW_PARTIAL",
      warnings: ["Manual edge case not checked."],
    });
  });
});
