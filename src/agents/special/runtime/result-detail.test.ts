import { describe, expect, it } from "vitest";
import {
  buildSpecialAgentCompletionDetail,
  buildSpecialAgentRunRefDetail,
  buildSpecialAgentWaitFailureDetail,
} from "./result-detail.js";

describe("special agent result detail", () => {
  it("builds child run references from available ids", () => {
    expect(
      buildSpecialAgentRunRefDetail({
        runId: "run-1",
        childSessionKey: "child-session-1",
      }),
    ).toEqual({
      childRunId: "run-1",
      childSessionKey: "child-session-1",
    });
  });

  it("includes wait status for wait failures", () => {
    expect(
      buildSpecialAgentWaitFailureDetail({
        status: "wait_failed",
        error: "timeout",
        runId: "run-2",
        childSessionKey: "child-session-2",
        waitStatus: "timeout",
      }),
    ).toEqual({
      childRunId: "run-2",
      childSessionKey: "child-session-2",
      waitStatus: "timeout",
    });
  });

  it("includes endedAt and usage detail for completed runs", () => {
    expect(
      buildSpecialAgentCompletionDetail({
        result: {
          status: "completed",
          runId: "run-3",
          childSessionKey: "child-session-3",
          reply: "done",
          endedAt: 123,
          usage: {
            input: 10,
            output: 4,
            cacheRead: 2,
            cacheWrite: 1,
            total: 17,
          },
          historyMessageCount: 3,
        },
        detail: {
          writtenCount: 1,
        },
      }),
    ).toEqual({
      childRunId: "run-3",
      childSessionKey: "child-session-3",
      writtenCount: 1,
      endedAt: 123,
      usage: {
        input: 10,
        output: 4,
        cacheRead: 2,
        cacheWrite: 1,
        total: 17,
      },
      historyMessageCount: 3,
    });
  });
});
