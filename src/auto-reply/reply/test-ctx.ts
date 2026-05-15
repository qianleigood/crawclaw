import { finalizeInboundContext } from "../../channels/inbound-context.js";
import type { FinalizedMsgContext, MsgContext } from "../templating.js";

export function buildTestCtx(overrides: Partial<MsgContext> = {}): FinalizedMsgContext {
  return finalizeInboundContext({
    Body: "",
    CommandBody: "",
    CommandSource: "text",
    From: "weixin:+1000",
    To: "weixin:+2000",
    ChatType: "direct",
    Provider: "weixin",
    Surface: "weixin",
    CommandAuthorized: false,
    ...overrides,
  });
}
