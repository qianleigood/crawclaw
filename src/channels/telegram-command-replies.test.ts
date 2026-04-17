import { describe, expect, it, vi } from "vitest";
import {
  buildTelegramCommandsListReply,
  buildTelegramModelsListReply,
  buildTelegramModelsProviderPickerReply,
} from "./telegram-command-replies.js";

describe("buildTelegramCommandsListReply", () => {
  it("returns text-only payload when there is a single page", () => {
    expect(
      buildTelegramCommandsListReply({
        text: "Commands page 1",
        currentPage: 1,
        totalPages: 1,
      }),
    ).toEqual({ text: "Commands page 1" });
  });

  it("attaches telegram pagination buttons for multi-page replies", () => {
    expect(
      buildTelegramCommandsListReply({
        text: "Commands page 2",
        currentPage: 2,
        totalPages: 3,
        agentId: "agent-main",
      }),
    ).toEqual({
      text: "Commands page 2",
      channelData: {
        telegram: {
          buttons: [
            [
              { text: "◀ Prev", callback_data: "commands_page_1:agent-main" },
              { text: "2/3", callback_data: "commands_page_noop:agent-main" },
              { text: "Next ▶", callback_data: "commands_page_3:agent-main" },
            ],
          ],
        },
      },
    });
  });
});

describe("buildTelegramModelsProviderPickerReply", () => {
  it("returns undefined when no providers are available", () => {
    const buildProviderKeyboard = vi.fn();
    expect(
      buildTelegramModelsProviderPickerReply({
        providers: [],
        buildProviderKeyboard,
      }),
    ).toBeUndefined();
    expect(buildProviderKeyboard).not.toHaveBeenCalled();
  });

  it("builds a provider picker payload", () => {
    const buttons = [[{ text: "openai (2)", callback_data: "mdl_list_openai_1" }]];
    const buildProviderKeyboard = vi.fn(() => buttons);
    expect(
      buildTelegramModelsProviderPickerReply({
        providers: [{ id: "openai", count: 2 }],
        buildProviderKeyboard,
      }),
    ).toEqual({
      text: "Select a provider:",
      channelData: { telegram: { buttons } },
    });
    expect(buildProviderKeyboard).toHaveBeenCalledWith([{ id: "openai", count: 2 }]);
  });
});

describe("buildTelegramModelsListReply", () => {
  it("wraps telegram model buttons into a reply payload", () => {
    const buttons = [[{ text: "gpt-4.1", callback_data: "mdl_sel_openai/gpt-4.1" }]];
    expect(
      buildTelegramModelsListReply({
        text: "Models (openai) — 1 available",
        buttons,
      }),
    ).toEqual({
      text: "Models (openai) — 1 available",
      channelData: { telegram: { buttons } },
    });
  });
});
