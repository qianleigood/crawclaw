import {
  buildWorkflowDiscordResumeCallbackData,
  ensureWorkflowInteractiveHandlersRegistered,
} from "./interactive.js";

type TelegramInlineButtons = ReadonlyArray<
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

export function buildWorkflowStatusCommand(executionId: string): string {
  return `/workflow status ${executionId.trim()}`;
}

export function buildWorkflowCancelCommand(executionId: string): string {
  return `/workflow cancel ${executionId.trim()}`;
}

export function buildWorkflowResumeCommand(executionId: string, input?: string): string {
  const trimmedExecutionId = executionId.trim();
  const trimmedInput = input?.trim();
  return trimmedInput
    ? `/workflow resume ${trimmedExecutionId} ${trimmedInput}`
    : `/workflow resume ${trimmedExecutionId}`;
}

export function buildWorkflowResumeCommandTemplate(executionId: string): string {
  return `/workflow resume ${executionId.trim()} <input>`;
}

export function buildWorkflowTelegramButtons(params: {
  executionId?: string;
  status?: string;
  scope?: string;
}): TelegramInlineButtons | undefined {
  const executionId = normalizeOptionalString(params.executionId);
  if (!executionId || normalizeOptionalString(params.scope)?.toLowerCase() === "step") {
    return undefined;
  }

  const rows: TelegramInlineButtons[number][] = [];
  const refresh = buildTelegramNativeCommandCallbackData(buildWorkflowStatusCommand(executionId));
  const cancel = buildTelegramNativeCommandCallbackData(buildWorkflowCancelCommand(executionId));
  const resume = buildTelegramNativeCommandCallbackData(buildWorkflowResumeCommand(executionId));
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
  executionId?: string;
  status?: string;
  scope?: string;
  workspaceDir?: string;
  agentDir?: string;
}): { blocks: Array<Record<string, unknown>> } | undefined {
  const executionId = normalizeOptionalString(params.executionId);
  if (!executionId || normalizeOptionalString(params.scope)?.toLowerCase() === "step") {
    return undefined;
  }
  ensureWorkflowInteractiveHandlersRegistered();

  const buttons: Array<Record<string, unknown>> = [
    {
      label: "Refresh",
      style: "primary",
      callbackData: buildWorkflowStatusCommand(executionId),
    },
  ];
  if (!isWorkflowTerminalStatus(params.status ?? "")) {
    buttons.push({
      label: "Cancel",
      style: "danger",
      callbackData: buildWorkflowCancelCommand(executionId),
    });
  }
  const resumeCallbackData = isWorkflowWaitingStatus(params.status ?? "")
    ? buildWorkflowDiscordResumeCallbackData({
        executionId,
        workspaceDir: params.workspaceDir,
        agentDir: params.agentDir,
      })
    : undefined;
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
