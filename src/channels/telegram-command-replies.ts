import type { ReplyPayload } from "../auto-reply/types.js";
import type { ProviderInfo } from "./telegram-model-picker.js";
import { buildCommandsPaginationKeyboard } from "./telegram-pagination.js";

type TelegramButton = Array<Array<{ text: string; callback_data: string }>>;

export function buildTelegramCommandsListReply(params: {
  text: string;
  currentPage: number;
  totalPages: number;
  agentId?: string;
}): ReplyPayload {
  if (params.totalPages <= 1) {
    return { text: params.text };
  }
  return {
    text: params.text,
    channelData: {
      telegram: {
        buttons: buildCommandsPaginationKeyboard(
          params.currentPage,
          params.totalPages,
          params.agentId,
        ),
      },
    },
  };
}

export function buildTelegramModelsProviderReply(params: {
  text: string;
  buttons: TelegramButton;
}): ReplyPayload {
  return {
    text: params.text,
    channelData: {
      telegram: {
        buttons: params.buttons,
      },
    },
  };
}

export function buildTelegramModelsProviderPickerReply(params: {
  providers: ProviderInfo[];
  buildProviderKeyboard: (providers: ProviderInfo[]) => TelegramButton;
  text?: string;
}): ReplyPayload | undefined {
  if (params.providers.length === 0) {
    return undefined;
  }
  return buildTelegramModelsProviderReply({
    text: params.text ?? "Select a provider:",
    buttons: params.buildProviderKeyboard(params.providers),
  });
}

export function buildTelegramModelsListReply(params: {
  text: string;
  buttons: TelegramButton;
}): ReplyPayload {
  return buildTelegramModelsProviderReply(params);
}
