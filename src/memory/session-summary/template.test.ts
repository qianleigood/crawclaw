import { describe, expect, it } from "vitest";
import {
  buildSessionSummaryTemplate,
  getSessionSummarySectionText,
  parseSessionSummaryDocument,
  renderSessionSummaryDocument,
} from "./template.js";

describe("session summary template", () => {
  it("renders and parses a Claude-style session summary document", () => {
    const rendered = renderSessionSummaryDocument({
      sections: {
        currentState: ["Working on summary support."],
        openLoops: ["Need to confirm the compaction boundary."],
        taskSpecification: ["Add a Claude-style summary.md workflow."],
        keyResults: ["Session summary files now exist."],
      },
    });

    expect(rendered).toContain("# Session Title");
    expect(rendered).toContain("# Current State");
    expect(rendered).toContain("# Open Loops");
    expect(rendered).toContain("# Task specification");
    expect(rendered).toContain("# Key results");
    expect(rendered).toContain("_What is actively being worked on right now?");

    const parsed = parseSessionSummaryDocument(rendered);
    expect(getSessionSummarySectionText(parsed, "currentState")).toBe(
      "Working on summary support.",
    );
    expect(getSessionSummarySectionText(parsed, "openLoops")).toBe(
      "Need to confirm the compaction boundary.",
    );
    expect(getSessionSummarySectionText(parsed, "taskSpecification")).toBe(
      "Add a Claude-style summary.md workflow.",
    );
    expect(getSessionSummarySectionText(parsed, "keyResults")).toBe(
      "Session summary files now exist.",
    );
  });

  it("builds the default template with the expected sections", () => {
    const template = buildSessionSummaryTemplate({ sessionId: "session-2" });
    expect(template).toContain("# Session Title");
    expect(template).toContain("# Current State");
    expect(template).toContain("# Open Loops");
    expect(template).toContain("# Task specification");
    expect(template).toContain("# Files and Functions");
    expect(template).toContain("# Workflow");
    expect(template).toContain("# Errors & Corrections");
    expect(template).toContain("# Codebase and System Documentation");
    expect(template).toContain("# Learnings");
    expect(template).toContain("# Key results");
    expect(template).toContain("# Worklog");
  });
});
