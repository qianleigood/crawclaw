import { describe, expect, it } from "vitest";
import { renderSessionSummaryForCompaction } from "./sections.js";

describe("session summary compaction view", () => {
  it("renders a structured compaction view from selected sections only", () => {
    const rendered = renderSessionSummaryForCompaction(`
# Session Title
_A short and distinctive 5-10 word descriptive title for the session. Super info dense, no filler_

Memory cleanup

# Current State
_What is actively being worked on right now? Pending tasks not yet completed. Immediate next steps._

Finishing the compaction rollout.

# Open Loops
_Which work items, decisions, or follow-ups are still open right now? Keep this tightly focused on unresolved items._

Need to wire summary promotion.

# Task specification
_What did the user ask to build? Any design decisions or other explanatory context_

Make session summary compaction-first.

# Workflow
_What bash commands are usually run and in what order? How to interpret their output if not obvious?_

Run the session-summary tests, then build.

# Errors & Corrections
_Errors encountered and how they were fixed. What did the user correct? What approaches failed and should not be tried again?_

Do not reintroduce prompt-time injection.

# Learnings
_What has worked well? What has not? What to avoid? Do not duplicate items from other sections_

Keep sections tight.

# Worklog
_Step by step, what was attempted, done? Very terse summary for each step_

Edited files.
`);

    expect(rendered).toContain("## Current State");
    expect(rendered).toContain("## Open Loops");
    expect(rendered).toContain("## Task Specification");
    expect(rendered).toContain("## Workflow");
    expect(rendered).toContain("## Errors & Corrections");
    expect(rendered).not.toContain("## Worklog");
    expect(rendered).not.toContain("## Learnings");
  });

  it("keeps the compaction view inside a provided token budget", () => {
    const rendered = renderSessionSummaryForCompaction(
      `
# Current State
${"Current state detail. ".repeat(80)}

# Open Loops
${"Open loop detail. ".repeat(80)}

# Task specification
${"Task specification detail. ".repeat(80)}

# Workflow
${"Workflow detail. ".repeat(80)}

# Errors & Corrections
${"Correction detail. ".repeat(80)}

# Key results
${"Result detail. ".repeat(80)}
`,
      { tokenBudget: 80 },
    );

    expect(rendered).toContain("## Current State");
    expect(rendered).not.toContain("## Key Results");
    expect(rendered.length).toBeLessThan(700);
  });
});
