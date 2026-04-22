import { describe, expect, it } from "vitest";
import { parseVerificationReport, parseVerificationVerdict } from "./verification-agent.js";

describe("parseVerificationReport", () => {
  it("parses a structured verification report", () => {
    const report = parseVerificationReport(
      [
        "VERDICT: PARTIAL",
        "SUMMARY: Core fix looks good, but Windows coverage is still missing.",
        "CHECKS:",
        "- PASS: Reproduced the original bug and confirmed the regression is gone.",
        "- FAIL: npm test -- --runInBand still fails on Windows CI parity.",
        "- WARN: Did not validate the fallback path on ARM hardware.",
        "FAILING_COMMANDS:",
        "- npm test -- --runInBand :: fails on Windows parity fixture",
        "WARNINGS:",
        "- ARM hardware path remains unverified.",
        "ARTIFACTS:",
        "- logs/windows-parity.txt",
        "- screenshots/failure.png",
      ].join("\n"),
    );

    expect(report).toEqual({
      verdict: "PARTIAL",
      summary: "Core fix looks good, but Windows coverage is still missing.",
      checks: [
        {
          status: "PASS",
          summary: "Reproduced the original bug and confirmed the regression is gone.",
        },
        {
          status: "FAIL",
          summary: "npm test -- --runInBand still fails on Windows CI parity.",
        },
        {
          status: "WARN",
          summary: "Did not validate the fallback path on ARM hardware.",
        },
      ],
      failingCommands: ["npm test -- --runInBand :: fails on Windows parity fixture"],
      warnings: ["ARM hardware path remains unverified."],
      artifacts: ["logs/windows-parity.txt", "screenshots/failure.png"],
    });
  });

  it("treats '- none' sections as empty and preserves legacy verdict parsing", () => {
    const text = [
      "VERDICT: PASS",
      "SUMMARY: Verified the fix.",
      "CHECKS:",
      "- PASS: Worker no longer crashes on empty payloads.",
      "FAILING_COMMANDS:",
      "- none",
      "WARNINGS:",
      "- none",
      "ARTIFACTS:",
      "- none",
    ].join("\n");

    expect(parseVerificationReport(text)).toEqual({
      verdict: "PASS",
      summary: "Verified the fix.",
      checks: [
        {
          status: "PASS",
          summary: "Worker no longer crashes on empty payloads.",
        },
      ],
      failingCommands: [],
      warnings: [],
      artifacts: [],
    });
    expect(parseVerificationVerdict(text)).toEqual({
      verdict: "PASS",
      summary: "Verified the fix.",
    });
  });
});
