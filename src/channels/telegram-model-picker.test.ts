import { describe, expect, it } from "vitest";
import {
  buildBrowseProvidersButton,
  buildModelsKeyboard,
  buildProviderKeyboard,
  calculateTotalPages,
  getModelsPageSize,
} from "./telegram-model-picker.js";

describe("telegram model picker", () => {
  it("builds provider keyboard rows in pairs", () => {
    expect(
      buildProviderKeyboard([
        { id: "anthropic", count: 12 },
        { id: "openai", count: 9 },
        { id: "minimax", count: 4 },
      ]),
    ).toEqual([
      [
        { text: "anthropic (12)", callback_data: "mdl_list_anthropic_1" },
        { text: "openai (9)", callback_data: "mdl_list_openai_1" },
      ],
      [{ text: "minimax (4)", callback_data: "mdl_list_minimax_1" }],
    ]);
  });

  it("builds model keyboard with current marker and navigation", () => {
    expect(
      buildModelsKeyboard({
        provider: "openai",
        models: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-coder"],
        currentModel: "openai/gpt-5.4-mini",
        currentPage: 2,
        totalPages: 3,
        pageSize: 1,
      }),
    ).toEqual([
      [{ text: "gpt-5.4-mini ✓", callback_data: "mdl_sel_openai/gpt-5.4-mini" }],
      [
        { text: "Previous", callback_data: "mdl_list_openai_1" },
        { text: "Next", callback_data: "mdl_list_openai_3" },
      ],
      [{ text: "<< Back", callback_data: "mdl_prov" }],
    ]);
  });

  it("falls back to compact callback data for long model ids", () => {
    const longModelId = "this-model-id-is-way-too-long-for-the-standard-telegram-callback-shape";
    expect(
      buildModelsKeyboard({
        provider: "openai",
        models: [longModelId],
        currentPage: 1,
        totalPages: 1,
      }),
    ).toEqual([[{ text: "<< Back", callback_data: "mdl_prov" }]]);
  });

  it("exposes browse providers button and page helpers", () => {
    expect(buildBrowseProvidersButton()).toEqual([
      [{ text: "Browse providers", callback_data: "mdl_prov" }],
    ]);
    expect(getModelsPageSize()).toBe(8);
    expect(calculateTotalPages(0)).toBe(0);
    expect(calculateTotalPages(17)).toBe(3);
  });
});
