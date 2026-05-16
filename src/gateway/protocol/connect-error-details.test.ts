import { describe, expect, it } from "vitest";
import {
  readConnectErrorDetailCode,
  readConnectErrorRecoveryAdvice,
} from "./connect-error-details.js";

describe("readConnectErrorDetailCode", () => {
  it("reads structured detail codes", () => {
    expect(readConnectErrorDetailCode({ code: "AUTH_TOKEN_MISMATCH" })).toBe("AUTH_TOKEN_MISMATCH");
  });

  it("returns null for invalid detail payloads", () => {
    expect(readConnectErrorDetailCode(null)).toBeNull();
    expect(readConnectErrorDetailCode("AUTH_TOKEN_MISMATCH")).toBeNull();
  });
});

describe("readConnectErrorRecoveryAdvice", () => {
  it("reads retry advice fields when present", () => {
    expect(
      readConnectErrorRecoveryAdvice({
        recommendedNextStep: "wait_then_retry",
      }),
    ).toEqual({
      recommendedNextStep: "wait_then_retry",
    });
  });

  it("returns empty advice for invalid payloads", () => {
    expect(readConnectErrorRecoveryAdvice(null)).toEqual({});
    expect(readConnectErrorRecoveryAdvice("x")).toEqual({});
    expect(
      readConnectErrorRecoveryAdvice({
        recommendedNextStep: "retry_with_magic",
      }),
    ).toEqual({ recommendedNextStep: undefined });
  });
});
