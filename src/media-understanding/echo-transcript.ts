import type { MsgContext } from "../auto-reply/templating.js";
import { resolveDeliverableTarget } from "../channels/deliverable-target.js";
import type { CrawClawConfig } from "../config/config.js";
import { logVerbose, shouldLogVerbose } from "../globals.js";

let deliverRuntimePromise: Promise<typeof import("../infra/outbound/deliver-runtime.js")> | null =
  null;

function loadDeliverRuntime() {
  deliverRuntimePromise ??= import("../infra/outbound/deliver-runtime.js");
  return deliverRuntimePromise;
}

export const DEFAULT_ECHO_TRANSCRIPT_FORMAT = '📝 "{transcript}"';

function formatEchoTranscript(transcript: string, format: string): string {
  return format.replace("{transcript}", transcript);
}

/**
 * Sends the transcript echo back to the originating chat.
 * Best-effort: logs on failure, never throws.
 */
export async function sendTranscriptEcho(params: {
  ctx: MsgContext;
  cfg: CrawClawConfig;
  transcript: string;
  format?: string;
}): Promise<void> {
  const { ctx, cfg, transcript } = params;
  const target = resolveDeliverableTarget({
    channel: ctx.Provider ?? ctx.Surface ?? "",
    to: ctx.OriginatingTo ?? ctx.From ?? "",
    accountId: ctx.AccountId ?? undefined,
    threadId: ctx.MessageThreadId ?? undefined,
  });

  if (!target) {
    if (shouldLogVerbose()) {
      logVerbose("media: echo-transcript skipped (no channel/to resolved from ctx)");
    }
    return;
  }

  const text = formatEchoTranscript(transcript, params.format ?? DEFAULT_ECHO_TRANSCRIPT_FORMAT);

  try {
    const { deliverOutboundPayloads } = await loadDeliverRuntime();
    await deliverOutboundPayloads({
      cfg,
      channel: target.channel,
      to: target.to,
      accountId: target.accountId,
      threadId: target.threadId,
      payloads: [{ text }],
      bestEffort: true,
    });
    if (shouldLogVerbose()) {
      logVerbose(`media: echo-transcript sent to ${target.channel}/${target.to}`);
    }
  } catch (err) {
    logVerbose(`media: echo-transcript delivery failed: ${String(err)}`);
  }
}
