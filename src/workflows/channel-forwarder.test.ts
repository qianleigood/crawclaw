import { describe, expect, it, vi } from "vitest";
import { __testing, forwardWorkflowActionToChannel } from "./channel-forwarder.js";
import type { WorkflowExecutionRecord } from "./types.js";

function createRecord(overrides: Partial<WorkflowExecutionRecord> = {}): WorkflowExecutionRecord {
  return {
    executionId: "exec_123",
    workflowId: "wf_publish_redbook_123",
    workflowName: "Publish Redbook Note",
    status: "running",
    startedAt: 1,
    updatedAt: 1,
    originSessionKey: "agent:main:main",
    originVisibilityMode: "summary",
    originWorkspaceDir: "/tmp/workspace",
    originAgentDir: "/tmp/agent-home",
    ...overrides,
  };
}

describe("workflow channel forwarder", () => {
  it("forwards root waiting updates in summary mode", async () => {
    const deliver = vi.fn(async () => []);

    const forwarded = await forwardWorkflowActionToChannel(
      {
        record: createRecord({
          status: "waiting_external",
        }),
        action: {
          actionId: "workflow:exec_123",
          status: "waiting",
          title: "Workflow waiting: Publish Redbook Note",
          projectedTitle: "Workflow waiting: Publish Redbook Note",
          projectedSummary: "Current step: Review",
        },
      },
      {
        getConfig: () => ({}) as never,
        deliver,
        resolveSessionTarget: () => ({
          channel: "telegram",
          to: "12345",
          threadId: 7,
        }),
      },
    );

    expect(forwarded).toBe(true);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "telegram",
        to: "12345",
        threadId: 7,
        bestEffort: true,
        payloads: [
          expect.objectContaining({
            text: "Workflow waiting: Publish Redbook Note\nCurrent step: Review",
            channelData: expect.objectContaining({
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
              workflow: expect.objectContaining({
                version: 1,
                executionId: "exec_123",
                workflowId: "wf_publish_redbook_123",
                workflowName: "Publish Redbook Note",
                status: "waiting",
                scope: "workflow",
                visibilityMode: "summary",
                sessionKey: "agent:main:main",
              }),
            }),
          }),
        ],
      }),
    );
  });

  it("does not forward step updates in summary mode", async () => {
    const deliver = vi.fn(async () => []);

    const forwarded = await forwardWorkflowActionToChannel(
      {
        record: createRecord({
          status: "waiting_external",
        }),
        action: {
          actionId: "workflow:exec_123:step:review",
          parentActionId: "workflow:exec_123",
          status: "waiting",
          title: "Workflow step waiting: Review",
          projectedTitle: "Workflow step waiting: Review",
          detail: {
            stepId: "review",
          },
        },
      },
      {
        getConfig: () => ({}) as never,
        deliver,
        resolveSessionTarget: () => ({
          channel: "telegram",
          to: "12345",
        }),
      },
    );

    expect(forwarded).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("forwards step updates in full mode", async () => {
    const deliver = vi.fn(async () => []);

    const forwarded = await forwardWorkflowActionToChannel(
      {
        record: createRecord({
          originVisibilityMode: "full",
        }),
        action: {
          actionId: "workflow:exec_123:step:review",
          parentActionId: "workflow:exec_123",
          status: "failed",
          title: "Workflow step failed: Review",
          projectedTitle: "Workflow step failed: Review",
          projectedSummary: "Approval rejected",
          detail: {
            stepId: "review",
          },
        },
      },
      {
        getConfig: () => ({}) as never,
        deliver,
        resolveSessionTarget: () => ({
          channel: "slack",
          to: "C123",
        }),
      },
    );

    expect(forwarded).toBe(true);
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "slack",
        to: "C123",
        payloads: [
          expect.objectContaining({
            text: "Workflow step failed: Review\nApproval rejected",
            channelData: {
              workflow: expect.objectContaining({
                scope: "step",
                stepId: "review",
                visibilityMode: "full",
              }),
              slack: expect.objectContaining({
                blocks: expect.arrayContaining([
                  expect.objectContaining({
                    type: "section",
                  }),
                  expect.objectContaining({
                    type: "context",
                  }),
                ]),
              }),
            },
          }),
        ],
      }),
    );
  });

  it("builds LINE flex cards for line targets", () => {
    const payload = __testing.buildWorkflowChannelPayload({
      record: createRecord({
        status: "succeeded",
      }),
      action: {
        actionId: "workflow:exec_123",
        status: "completed",
        title: "Workflow completed: Publish Redbook Note",
        projectedTitle: "Workflow completed: Publish Redbook Note",
        projectedSummary: "Current step: Publish",
      },
      target: {
        channel: "line",
      },
    });

    expect(payload.text).toBe("Workflow completed: Publish Redbook Note\nCurrent step: Publish");
    expect(payload.channelData?.workflow).toEqual(
      expect.objectContaining({
        scope: "workflow",
        status: "completed",
      }),
    );
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

  it("uses shared workflow visibility when projected fields are absent", () => {
    const payload = __testing.buildWorkflowChannelPayload({
      record: createRecord({
        status: "waiting_external",
      }),
      action: {
        actionId: "workflow:exec_123:step:review",
        parentActionId: "workflow:exec_123",
        status: "waiting",
        title: "raw workflow title",
        summary: "Approve publish",
        detail: {
          stepId: "review",
          stepTitle: "Review",
          stepStatus: "waiting",
        },
      },
      target: {
        channel: "telegram",
      },
    });

    expect(payload.text).toBe("Workflow step waiting: Review\nApprove publish");
  });

  it("builds telegram buttons for workflow targets", () => {
    const payload = __testing.buildWorkflowChannelPayload({
      record: createRecord({
        status: "waiting_external",
      }),
      action: {
        actionId: "workflow:exec_123",
        status: "waiting",
        title: "Workflow waiting: Publish Redbook Note",
        projectedTitle: "Workflow waiting: Publish Redbook Note",
      },
      target: {
        channel: "telegram",
      },
    });

    expect(payload.channelData?.telegram).toEqual({
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
    });
  });

  it("builds discord components for workflow targets", () => {
    const payload = __testing.buildWorkflowChannelPayload({
      record: createRecord({
        status: "succeeded",
      }),
      action: {
        actionId: "workflow:exec_123",
        status: "completed",
        title: "Workflow completed: Publish Redbook Note",
        projectedTitle: "Workflow completed: Publish Redbook Note",
      },
      target: {
        channel: "discord",
      },
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
  });

  it("builds a discord resume modal for waiting workflow targets", () => {
    const payload = __testing.buildWorkflowChannelPayload({
      record: createRecord({
        status: "waiting_external",
      }),
      action: {
        actionId: "workflow:exec_123",
        status: "waiting",
        title: "Workflow waiting: Publish Redbook Note",
        projectedTitle: "Workflow waiting: Publish Redbook Note",
      },
      target: {
        channel: "discord",
      },
    });

    expect(payload.channelData?.discord).toEqual({
      components: expect.objectContaining({
        blocks: [
          {
            type: "actions",
            buttons: [
              {
                label: "Refresh",
                style: "primary",
                callbackData: "/workflow status exec_123",
              },
              {
                label: "Cancel",
                style: "danger",
                callbackData: "/workflow cancel exec_123",
              },
            ],
          },
        ],
        modal: expect.objectContaining({
          title: "Resume workflow",
          triggerLabel: "Resume",
          triggerStyle: "success",
          callbackData: expect.stringMatching(/^workflow:resume:/),
        }),
      }),
    });
  });

  it("classifies compensation actions separately", () => {
    expect(
      __testing.resolveActionScope({
        actionId: "workflow:exec_123:step:review:compensation",
        status: "failed",
        title: "Workflow compensation failed: Review",
        detail: {
          stepId: "review",
          compensationStatus: "failed",
        },
      }),
    ).toBe("compensation");
  });
});
