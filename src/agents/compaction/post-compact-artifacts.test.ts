import { describe, expect, it } from "vitest";
import {
  extractCompactPostArtifacts,
  summarizeCompactPostArtifacts,
} from "./post-compact-artifacts.js";

const validArtifacts = {
  boundaryMarker: {
    type: "system",
    subtype: "compact_boundary",
    content: "Conversation compacted",
    compactMetadata: {
      trigger: "auto",
      preTokens: 1200,
      messagesSummarized: 42,
      resumedWithoutBoundary: false,
      preCompactDiscoveredTools: ["read", "edit"],
      preservedSegment: {
        headMessageId: "m-10",
        anchorKind: "summary_message",
        anchorIndex: 0,
        tailMessageId: "m-18",
      },
    },
  },
  summaryMessages: [
    {
      role: "user",
      subtype: "compact_summary",
      content: "summary",
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    },
  ],
  messagesToKeep: [
    {
      messageId: "m-10",
      turnIndex: 10,
      role: "assistant",
    },
  ],
  attachments: [
    {
      type: "plan_attachment",
      title: "Current Plan",
      source: "session_summary",
      content: "plan",
    },
  ],
};

describe("post-compact artifact helpers", () => {
  it("extracts a valid artifact payload", () => {
    const extracted = extractCompactPostArtifacts(validArtifacts);
    expect(extracted).toBeDefined();
    expect(extracted?.boundaryMarker.compactMetadata.preCompactDiscoveredTools).toEqual([
      "read",
      "edit",
    ]);
    expect(extracted?.messagesToKeep[0]?.messageId).toBe("m-10");
  });

  it("returns empty summary for invalid payloads", () => {
    const summary = summarizeCompactPostArtifacts({ boundaryMarker: { type: "system" } });
    expect(summary).toEqual({
      summaryMessageCount: 0,
      keptMessageCount: 0,
      attachmentCount: 0,
      discoveredToolsCount: 0,
      hasPreservedSegment: false,
    });
  });

  it("summarizes counts for valid payloads", () => {
    const summary = summarizeCompactPostArtifacts(validArtifacts);
    expect(summary).toEqual({
      summaryMessageCount: 1,
      keptMessageCount: 1,
      attachmentCount: 1,
      discoveredToolsCount: 2,
      hasPreservedSegment: true,
    });
  });
});
