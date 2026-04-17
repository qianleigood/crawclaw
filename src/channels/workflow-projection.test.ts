import { describe, expect, it } from "vitest";
import {
  buildWorkflowControlChannelData,
  buildWorkflowReplyPayload,
} from "./workflow-projection.js";

function createWorkflowMetadata() {
  return {
    version: 1 as const,
    actionId: "workflow:exec_123",
    executionId: "exec_123",
    workflowId: "wf_publish_redbook_123",
    workflowName: "Publish Redbook Note",
    status: "waiting",
    scope: "workflow" as const,
    visibilityMode: "summary",
    sessionKey: "agent:main:main",
  };
}

describe("workflow channel projection", () => {
  it("builds slack blocks with title, summary, and footer", () => {
    const payload = buildWorkflowReplyPayload({
      channel: "slack",
      title: "Workflow waiting: Publish Redbook Note",
      summary: "Current step: Review",
      footer: "Status: waiting · Workflow · Execution: exec_123",
      workflow: createWorkflowMetadata(),
    });

    expect(payload.text).toBe("Workflow waiting: Publish Redbook Note\nCurrent step: Review");
    expect(payload.channelData?.slack).toEqual(
      expect.objectContaining({
        blocks: [
          expect.objectContaining({ type: "section" }),
          expect.objectContaining({ type: "section" }),
          expect.objectContaining({ type: "context" }),
        ],
      }),
    );
  });

  it("builds line flex cards for line targets", () => {
    const payload = buildWorkflowReplyPayload({
      channel: "line",
      title: "Workflow completed: Publish Redbook Note",
      summary: "Current step: Publish",
      footer: "Status: completed · Workflow · Execution: exec_123",
      workflow: {
        ...createWorkflowMetadata(),
        status: "completed",
      },
    });

    expect(payload.channelData?.line).toEqual(
      expect.objectContaining({
        flexMessage: expect.objectContaining({
          altText: "Workflow completed: Publish Redbook Note",
          contents: expect.objectContaining({
            type: "bubble",
          }),
        }),
      }),
    );
  });

  it("includes telegram buttons only for telegram targets", () => {
    const payload = buildWorkflowReplyPayload({
      channel: "telegram",
      title: "Workflow waiting: Publish Redbook Note",
      footer: "Status: waiting · Workflow · Execution: exec_123",
      workflow: createWorkflowMetadata(),
      refreshCommand: "/workflow status exec_123",
    });

    expect(payload.channelData?.telegram).toEqual({
      buttons: [
        [
          {
            text: "Refresh",
            callback_data: "tgcmd:/workflow status exec_123",
            style: "primary",
          },
        ],
      ],
    });
    expect(payload.channelData?.discord).toBeUndefined();
  });

  it("includes discord components only for discord targets", () => {
    const payload = buildWorkflowReplyPayload({
      channel: "discord",
      title: "Workflow waiting: Publish Redbook Note",
      footer: "Status: waiting · Workflow · Execution: exec_123",
      workflow: createWorkflowMetadata(),
      refreshCommand: "/workflow status exec_123",
    });

    expect(payload.channelData?.discord).toEqual({
      components: {
        blocks: [
          {
            type: "actions",
            buttons: [
              {
                label: "Refresh",
                style: "primary",
                callbackData: "/workflow status exec_123",
              },
            ],
          },
        ],
      },
    });
    expect(payload.channelData?.telegram).toBeUndefined();
  });

  it("builds telegram control channel data without workflow reply text projection", () => {
    expect(
      buildWorkflowControlChannelData({
        channel: "telegram",
        workflow: {
          scope: "workflow",
          status: "waiting",
        },
        refreshCommand: "/workflow status exec_123",
        cancelCommand: "/workflow cancel exec_123",
        resumeCommand: "/workflow resume exec_123",
      }),
    ).toEqual({
      telegram: {
        buttons: [
          [
            {
              text: "Refresh",
              callback_data: "tgcmd:/workflow status exec_123",
              style: "primary",
            },
            {
              text: "Resume",
              callback_data: "tgcmd:/workflow resume exec_123",
              style: "success",
            },
            {
              text: "Cancel",
              callback_data: "tgcmd:/workflow cancel exec_123",
              style: "danger",
            },
          ],
        ],
      },
    });
  });
});
