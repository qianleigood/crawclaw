import { describe, expect, it } from "vitest";
import { GatewayRequestError } from "../gateway.ts";
import { isMissingOperatorReadScopeError } from "./scope-errors.ts";

describe("scope error helpers", () => {
  it("recognizes structured scope detail codes from gateway RPC responses", () => {
    expect(
      isMissingOperatorReadScopeError(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "missing scope: operator.read",
          details: {
            code: "SCOPE_MISSING",
            missingScope: "operator.read",
            method: "channels.status",
          },
        }),
      ),
    ).toBe(true);
  });

  it("keeps the legacy message fallback for older gateways", () => {
    expect(
      isMissingOperatorReadScopeError(
        new GatewayRequestError({
          code: "INVALID_REQUEST",
          message: "missing scope: operator.read",
        }),
      ),
    ).toBe(true);
  });
});
