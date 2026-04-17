type WorkflowProjectionScope = "workflow" | "step" | "compensation";

type WorkflowTelegramButtons = ReadonlyArray<
  ReadonlyArray<{
    text: string;
    callback_data: string;
    style?: "danger" | "success" | "primary";
  }>
>;

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isWorkflowTerminalStatus(status: string): boolean {
  return ["completed", "succeeded", "failed", "cancelled"].includes(status.trim().toLowerCase());
}

function isWorkflowWaitingStatus(status: string): boolean {
  return ["waiting", "waiting_external", "waiting_input"].includes(status.trim().toLowerCase());
}

function buildTelegramNativeCommandCallbackData(commandText: string): string | undefined {
  const normalized = commandText.trim();
  if (!normalized) {
    return undefined;
  }
  const callback = `tgcmd:${normalized}`;
  return Buffer.byteLength(callback, "utf8") <= 64 ? callback : undefined;
}

export function buildWorkflowTelegramButtons(params: {
  scope?: WorkflowProjectionScope;
  status?: string;
  refreshCommand?: string;
  cancelCommand?: string;
  resumeCommand?: string;
}): WorkflowTelegramButtons | undefined {
  if (normalizeOptionalString(params.scope)?.toLowerCase() === "step") {
    return undefined;
  }

  const rows: WorkflowTelegramButtons[number][] = [];
  const refresh = buildTelegramNativeCommandCallbackData(params.refreshCommand ?? "");
  const cancel = buildTelegramNativeCommandCallbackData(params.cancelCommand ?? "");
  const resume = buildTelegramNativeCommandCallbackData(params.resumeCommand ?? "");
  if (refresh) {
    rows.push([
      {
        text: "Refresh",
        callback_data: refresh,
        style: "primary",
      },
      ...(isWorkflowWaitingStatus(params.status ?? "") && resume
        ? [
            {
              text: "Resume",
              callback_data: resume,
              style: "success" as const,
            },
          ]
        : []),
      ...(!isWorkflowTerminalStatus(params.status ?? "") && cancel
        ? [
            {
              text: "Cancel",
              callback_data: cancel,
              style: "danger" as const,
            },
          ]
        : []),
    ]);
  }
  return rows.length > 0 ? rows : undefined;
}

export function buildWorkflowDiscordComponents(params: {
  scope?: WorkflowProjectionScope;
  status?: string;
  refreshCommand?: string;
  cancelCommand?: string;
  resumeCallbackData?: string;
}): { blocks: Array<Record<string, unknown>>; modal?: Record<string, unknown> } | undefined {
  if (normalizeOptionalString(params.scope)?.toLowerCase() === "step") {
    return undefined;
  }
  const refreshCommand = normalizeOptionalString(params.refreshCommand);
  if (!refreshCommand) {
    return undefined;
  }

  const buttons: Array<Record<string, unknown>> = [
    {
      label: "Refresh",
      style: "primary",
      callbackData: refreshCommand,
    },
  ];
  if (
    !isWorkflowTerminalStatus(params.status ?? "") &&
    normalizeOptionalString(params.cancelCommand)
  ) {
    buttons.push({
      label: "Cancel",
      style: "danger",
      callbackData: normalizeOptionalString(params.cancelCommand),
    });
  }

  const resumeCallbackData = normalizeOptionalString(params.resumeCallbackData);
  return {
    blocks: [
      {
        type: "actions",
        buttons,
      },
    ],
    ...(resumeCallbackData
      ? {
          modal: {
            title: "Resume workflow",
            triggerLabel: "Resume",
            triggerStyle: "success",
            callbackData: resumeCallbackData,
            fields: [
              {
                type: "text",
                name: "input",
                label: "Resume input",
                placeholder: "Optional input or approval note",
                style: "paragraph",
              },
            ],
          },
        }
      : {}),
  };
}
