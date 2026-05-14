import { describe, expect, it } from "vitest";
import type { MsgContext } from "../../auto-reply/templating.js";
import { normalizeExplicitSessionKey } from "./explicit-session-key-normalization.js";

function makeCtx(overrides: Partial<MsgContext>): MsgContext {
  return {
    Body: "",
    From: "",
    To: "",
    ...overrides,
  } as MsgContext;
}

describe("normalizeExplicitSessionKey", () => {
  it("lowercases retained provider keys", () => {
    expect(
      normalizeExplicitSessionKey(
        "Agent:Fina:Feishu:Group:OC_123",
        makeCtx({
          Surface: "feishu",
          From: "feishu:group:OC_123",
        }),
      ),
    ).toBe("agent:fina:feishu:group:oc_123");
  });

  it("passes through unknown providers after normalization", () => {
    expect(
      normalizeExplicitSessionKey(
        "Agent:Fina:Custom:DM:ABC",
        makeCtx({
          Surface: "custom",
          From: "custom:U123",
        }),
      ),
    ).toBe("agent:fina:custom:dm:abc");
  });
});
