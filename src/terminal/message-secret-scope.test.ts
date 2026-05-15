import { describe, expect, it } from "vitest";
import { resolveMessageSecretScope } from "./message-secret-scope.js";

describe("resolveMessageSecretScope", () => {
  it("prefers explicit channel/account inputs", () => {
    expect(
      resolveMessageSecretScope({
        channel: "Signal",
        accountId: "Ops",
      }),
    ).toEqual({
      accountId: "ops",
    });
  });

  it("infers channel from a prefixed target", () => {
    expect(
      resolveMessageSecretScope({
        target: "signal:12345",
      }),
    ).toEqual({});
  });

  it("infers a shared channel from target arrays", () => {
    expect(
      resolveMessageSecretScope({
        targets: ["signal:one", "signal:two"],
      }),
    ).toEqual({});
  });

  it("does not infer a channel when target arrays mix channels", () => {
    expect(
      resolveMessageSecretScope({
        targets: ["signal:one", "weixin:two"],
      }),
    ).toEqual({});
  });

  it("uses fallback channel/account when direct inputs are missing", () => {
    expect(
      resolveMessageSecretScope({
        fallbackChannel: "Signal",
        fallbackAccountId: "Chat",
      }),
    ).toEqual({
      accountId: "chat",
    });
  });
});
