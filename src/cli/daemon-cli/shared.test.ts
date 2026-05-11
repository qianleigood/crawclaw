import { describe, expect, it } from "vitest";
import { theme } from "../../terminal/theme.js";
import { renderGatewayServiceStartHints, resolveRuntimeStatusColor } from "./shared.js";

describe("resolveRuntimeStatusColor", () => {
  it("maps known runtime states to expected theme colors", () => {
    expect(resolveRuntimeStatusColor("running")).toBe(theme.success);
    expect(resolveRuntimeStatusColor("stopped")).toBe(theme.error);
    expect(resolveRuntimeStatusColor("unknown")).toBe(theme.muted);
  });

  it("falls back to warning color for unexpected states", () => {
    expect(resolveRuntimeStatusColor("degraded")).toBe(theme.warn);
    expect(resolveRuntimeStatusColor(undefined)).toBe(theme.muted);
  });
});

describe("renderGatewayServiceStartHints", () => {
  it("renders platform service start hints", () => {
    expect(
      renderGatewayServiceStartHints({
        CRAWCLAW_PROFILE: "work",
      } as NodeJS.ProcessEnv),
    ).toEqual(
      expect.arrayContaining([expect.stringContaining("crawclaw --profile work gateway install")]),
    );
  });
});
