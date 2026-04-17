import { describe, expect, it } from "vitest";
import {
  compileSlackInteractiveReplies,
  hasSlackDirectives,
  parseSlackDirectives,
} from "./slack-directives.js";

describe("slack-directives", () => {
  it("detects supported Slack directive markers", () => {
    expect(hasSlackDirectives("Pick one [[slack_buttons: Approve:approve, Reject:reject]]")).toBe(
      true,
    );
    expect(hasSlackDirectives("No directives here")).toBe(false);
  });

  it("parses Slack button directives into interactive blocks", () => {
    const result = parseSlackDirectives({
      text: "Pick one [[slack_buttons: Approve:approve, Reject:reject]]",
    });

    expect(result.text).toBe("Pick one");
    expect(result.interactive?.blocks).toEqual([
      { type: "text", text: "Pick one" },
      {
        type: "buttons",
        buttons: [
          { label: "Approve", value: "approve" },
          { label: "Reject", value: "reject" },
        ],
      },
    ]);
  });

  it("compiles options lines into Slack interactive replies", () => {
    const result = compileSlackInteractiveReplies({
      text: "Choose an option\nOptions: Alpha, Beta, Gamma.",
    });

    expect(result.text).toBe("Choose an option");
    expect(result.interactive?.blocks).toEqual([
      { type: "text", text: "Choose an option" },
      {
        type: "buttons",
        buttons: [
          { label: "Alpha", value: "Alpha" },
          { label: "Beta", value: "Beta" },
          { label: "Gamma", value: "Gamma" },
        ],
      },
    ]);
  });
});
