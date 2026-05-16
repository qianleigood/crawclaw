import { randomUUID } from "node:crypto";
import type { ReasoningLevel, ThinkLevel } from "../agents/thinking.js";
import type { GetReplyOptions, ReplyPayload } from "../chat/reply-payload.js";
import type { CrawClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { callGatewayCli } from "../gateway/call.js";
import type { BlockReplyChunking } from "./block-reply-chunker.js";
import { normalizeRustAgentRunResult, type RustAgentPayload } from "./rust-agent-result.js";

type RunBtwSideQuestionParams = {
  cfg: CrawClawConfig;
  agentDir: string;
  provider: string;
  model: string;
  question: string;
  sessionEntry: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  resolvedThinkLevel?: ThinkLevel;
  resolvedReasoningLevel: ReasoningLevel;
  blockReplyChunking?: BlockReplyChunking;
  resolvedBlockStreamingBreak?: "text_end" | "message_end";
  opts?: GetReplyOptions;
  isNewSession: boolean;
};

function payloadText(payload: RustAgentPayload): string | undefined {
  return typeof payload.text === "string" && payload.text.trim().length > 0
    ? payload.text
    : undefined;
}

async function emitReasoningPayloads(
  payloads: RustAgentPayload[],
  opts: GetReplyOptions | undefined,
): Promise<void> {
  for (const payload of payloads) {
    const text = payloadText(payload);
    if (payload.isReasoning && text) {
      await opts?.onReasoningStream?.({ text, isReasoning: true });
    }
  }
}

export async function runBtwSideQuestion(
  params: RunBtwSideQuestionParams,
): Promise<ReplyPayload | undefined> {
  const question = params.question.trim();
  if (!question) {
    throw new Error("No BTW question provided.");
  }
  const sessionId = params.sessionEntry.sessionId?.trim();
  const sessionKey = params.sessionKey?.trim() || sessionId;
  if (!sessionId || !sessionKey) {
    throw new Error("No active session context.");
  }

  const request = {
    runId: params.opts?.runId ?? randomUUID(),
    agentId: "main",
    sessionKey,
    inbound: {
      channel: "btw",
      from: "user",
      to: "agent:main",
      chatType: "direct",
      body: question,
      rawBody: question,
      threadId: sessionKey,
      mediaUrls: [],
      metadata: { btw: { question } },
    },
    model: {
      provider: params.provider,
      model: params.model,
      reasoningLevel: "off",
    },
    enabledTools: [],
    options: {
      mode: "btw",
      btwQuestion: question,
      ephemeral: true,
    },
  };
  const startedAt = Date.now();
  const rawResult = await callGatewayCli({
    method: "agent.command.run",
    params: request,
    timeoutMs: params.opts?.timeoutOverrideSeconds
      ? params.opts.timeoutOverrideSeconds * 1000
      : params.opts?.blockReplyTimeoutMs,
  });
  const result = normalizeRustAgentRunResult(rawResult, startedAt);

  const payloads = result.payloads ?? [];
  await emitReasoningPayloads(payloads, params.opts);
  await params.opts?.onReasoningEnd?.();

  const answer =
    payloads.map(payloadText).find((text): text is string => !!text) ??
    (typeof result.assistantText === "string" && result.assistantText.trim()
      ? result.assistantText
      : undefined);
  if (!answer) {
    throw new Error("No BTW response generated.");
  }

  const reply = { text: answer, btw: { question } };
  if (
    params.opts?.onBlockReply &&
    params.blockReplyChunking &&
    !params.opts.disableBlockStreaming
  ) {
    await params.opts.onBlockReply(reply);
    return undefined;
  }
  return reply;
}
