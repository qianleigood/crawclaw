import { describe, expect, it } from "vitest";
import {
  resolveMatrixConversationId,
  resolveMatrixParentConversationId,
} from "./matrix-context.js";

describe("resolveMatrixConversationId", () => {
  it("prefers thread ids when present", () => {
    expect(
      resolveMatrixConversationId({
        ctx: {
          MessageThreadId: "$thread-id",
          OriginatingTo: "matrix:!room:example.org",
        },
        command: {},
      }),
    ).toBe("$thread-id");
  });

  it("falls back to matrix room ids", () => {
    expect(
      resolveMatrixConversationId({
        ctx: {
          OriginatingTo: "matrix:!room:example.org",
        },
        command: {},
      }),
    ).toBe("!room:example.org");
  });
});

describe("resolveMatrixParentConversationId", () => {
  it("accepts room: prefixes", () => {
    expect(
      resolveMatrixParentConversationId({
        ctx: {
          To: "room:!room:example.org",
        },
        command: {},
      }),
    ).toBe("!room:example.org");
  });

  it("accepts room aliases", () => {
    expect(
      resolveMatrixParentConversationId({
        ctx: {},
        command: {
          to: "#ops:example.org",
        },
      }),
    ).toBe("#ops:example.org");
  });
});
