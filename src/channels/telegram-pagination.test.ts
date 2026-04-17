import { describe, expect, it } from "vitest";
import { buildCommandsPaginationKeyboard } from "./telegram-pagination.js";

describe("telegram pagination", () => {
  it("adds agent id to callback data when provided", () => {
    expect(buildCommandsPaginationKeyboard(2, 3, "agent-main")).toEqual([
      [
        { text: "◀ Prev", callback_data: "commands_page_1:agent-main" },
        { text: "2/3", callback_data: "commands_page_noop:agent-main" },
        { text: "Next ▶", callback_data: "commands_page_3:agent-main" },
      ],
    ]);
  });

  it("omits prev or next buttons at the edges", () => {
    expect(buildCommandsPaginationKeyboard(1, 3)).toEqual([
      [
        { text: "1/3", callback_data: "commands_page_noop" },
        { text: "Next ▶", callback_data: "commands_page_2" },
      ],
    ]);

    expect(buildCommandsPaginationKeyboard(3, 3)).toEqual([
      [
        { text: "◀ Prev", callback_data: "commands_page_2" },
        { text: "3/3", callback_data: "commands_page_noop" },
      ],
    ]);
  });
});
