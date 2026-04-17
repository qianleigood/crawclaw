import { describe, expect, it } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";
import { finalizeInboundContext } from "./inbound-context.js";

describe("finalizeInboundContext", () => {
  it("fills command and agent bodies from normalized inbound text", () => {
    const ctx: MsgContext = {
      Body: "a\r\nb",
      RawBody: "raw\r\nline",
      ChatType: "channel",
      From: "whatsapp:group:123@g.us",
      GroupSubject: "Test",
    };

    const out = finalizeInboundContext(ctx);
    expect(out.Body).toBe("a\nb");
    expect(out.RawBody).toBe("raw\nline");
    expect(out.BodyForAgent).toBe("raw\nline");
    expect(out.BodyForCommands).toBe("raw\nline");
    expect(out.CommandAuthorized).toBe(false);
    expect(out.ChatType).toBe("channel");
    expect(out.ConversationLabel).toContain("Test");
  });

  it("preserves literal backslash-n sequences and media defaults", () => {
    const out = finalizeInboundContext({
      Body: "C:\\Work\\nxxx\\README.md",
      RawBody: "C:\\Work\\nxxx\\README.md",
      MediaPath: "/tmp/file.bin",
      ChatType: "direct",
      From: "web:user",
    } satisfies MsgContext);

    expect(out.BodyForAgent).toBe("C:\\Work\\nxxx\\README.md");
    expect(out.MediaType).toBe("application/octet-stream");
    expect(out.MediaTypes).toEqual(["application/octet-stream"]);
  });
});
