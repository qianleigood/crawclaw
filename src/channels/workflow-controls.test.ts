import { describe, expect, it } from "vitest";
import {
  buildWorkflowDiscordComponents,
  buildWorkflowTelegramButtons,
} from "./workflow-controls.js";

describe("workflow channel controls", () => {
  it("builds telegram workflow buttons from workflow commands", () => {
    expect(
      buildWorkflowTelegramButtons({
        scope: "workflow",
        status: "waiting",
        refreshCommand: "/workflow status exec_123",
        cancelCommand: "/workflow cancel exec_123",
        resumeCommand: "/workflow resume exec_123",
      }),
    ).toEqual([
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
    ]);
  });

  it("does not build workflow buttons for step scope", () => {
    expect(
      buildWorkflowTelegramButtons({
        scope: "step",
        status: "waiting",
        refreshCommand: "/workflow status exec_123",
      }),
    ).toBeUndefined();
  });

  it("builds discord components and modal from workflow commands and callback data", () => {
    expect(
      buildWorkflowDiscordComponents({
        scope: "workflow",
        status: "waiting",
        refreshCommand: "/workflow status exec_123",
        cancelCommand: "/workflow cancel exec_123",
        resumeCallbackData: "workflow:resume:abc123",
      }),
    ).toEqual({
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
        callbackData: "workflow:resume:abc123",
      }),
    });
  });
});
