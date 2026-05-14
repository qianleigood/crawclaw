import type { z } from "crawclaw/plugin-sdk/zod";

function hasOpenAllowFrom(allowFrom: Array<string | number> | undefined): boolean {
  return (allowFrom ?? []).some((entry) => String(entry).trim() === "*");
}

export function requireChannelOpenAllowFrom(params: {
  channel: string;
  policy?: string;
  allowFrom?: Array<string | number>;
  ctx: z.RefinementCtx;
}) {
  if (params.policy !== "open" || hasOpenAllowFrom(params.allowFrom)) {
    return;
  }
  params.ctx.addIssue({
    code: "custom",
    path: ["allowFrom"],
    message: `channels.${params.channel}.dmPolicy="open" requires channels.${params.channel}.allowFrom to include "*"`,
  });
}
