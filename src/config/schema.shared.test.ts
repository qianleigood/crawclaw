import { describe, expect, it } from "vitest";
import { findWildcardHintMatch, schemaHasChildren } from "./schema.shared.js";

describe("schema.shared", () => {
  it("prefers the most specific wildcard hint match", () => {
    const match = findWildcardHintMatch({
      uiHints: {
        "channels.*.token": { label: "wildcard" },
        "channels.feishu.token": { label: "feishu" },
      },
      path: "channels.feishu.token",
      splitPath: (value) => value.split("."),
    });

    expect(match).toEqual({
      path: "channels.feishu.token",
      hint: { label: "feishu" },
    });
  });

  it("treats branch schemas as having children", () => {
    expect(
      schemaHasChildren({
        oneOf: [{}, { properties: { token: {} } }],
      }),
    ).toBe(true);
  });
});
