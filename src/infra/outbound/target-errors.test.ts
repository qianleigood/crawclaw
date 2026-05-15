import { describe, expect, it } from "vitest";
import {
  ambiguousTargetError,
  ambiguousTargetMessage,
  missingTargetError,
  missingTargetMessage,
  unknownTargetError,
  unknownTargetMessage,
} from "./target-errors.js";

describe("target error helpers", () => {
  it.each([
    {
      actual: missingTargetMessage("Feishu"),
      expected: "Delivering to Feishu requires target",
    },
    {
      actual: missingTargetMessage("Feishu", "Use channel:C123"),
      expected: "Delivering to Feishu requires target Use channel:C123",
    },
    {
      actual: missingTargetError("Feishu", "Use channel:C123").message,
      expected: "Delivering to Feishu requires target Use channel:C123",
    },
    {
      actual: missingTargetMessage("Feishu", "   "),
      expected: "Delivering to Feishu requires target",
    },
    {
      actual: ambiguousTargetMessage("QQBot", "general", "   "),
      expected: 'Ambiguous target "general" for QQBot. Provide a unique name or an explicit id.',
    },
    {
      actual: unknownTargetMessage("QQBot", "general", "   "),
      expected: 'Unknown target "general" for QQBot.',
    },
    {
      actual: ambiguousTargetMessage("QQBot", "general"),
      expected: 'Ambiguous target "general" for QQBot. Provide a unique name or an explicit id.',
    },
    {
      actual: ambiguousTargetMessage("QQBot", "general", "Use channel:123"),
      expected:
        'Ambiguous target "general" for QQBot. Provide a unique name or an explicit id. Hint: Use channel:123',
    },
    {
      actual: unknownTargetMessage("QQBot", "general", "Use channel:123"),
      expected: 'Unknown target "general" for QQBot. Hint: Use channel:123',
    },
    {
      actual: unknownTargetError("QQBot", "general").message,
      expected: 'Unknown target "general" for QQBot.',
    },
    {
      actual: missingTargetMessage("Feishu", "  Use channel:C123  "),
      expected: "Delivering to Feishu requires target Use channel:C123",
    },
    {
      actual: unknownTargetMessage("QQBot", "general", "  Use channel:123  "),
      expected: 'Unknown target "general" for QQBot. Hint: Use channel:123',
    },
  ])("formats target error helper output for %j", ({ actual, expected }) => {
    expect(actual).toBe(expected);
  });

  it("includes the hint in ambiguous target errors", () => {
    expect(ambiguousTargetError("QQBot", "general", "Use channel:123").message).toContain(
      "Hint: Use channel:123",
    );
  });
});
