import { z } from "zod";
import { AgentModelSchema } from "./zod-schema.agent-model.js";
import {
  GroupChatSchema,
  HumanDelaySchema,
  IdentitySchema,
  SecretInputSchema,
  ToolsLinksSchema,
  ToolsMediaSchema,
} from "./zod-schema.core.js";
import { sensitive } from "./zod-schema.sensitive.js";

export const HeartbeatSchema = z
  .object({
    model: z.string().optional(),
    session: z.string().optional(),
    includeReasoning: z.boolean().optional(),
    target: z.string().optional(),
    directPolicy: z.union([z.literal("allow"), z.literal("block")]).optional(),
    to: z.string().optional(),
    accountId: z.string().optional(),
    prompt: z.string().optional(),
    ackMaxChars: z.number().int().nonnegative().optional(),
    suppressToolErrorWarnings: z.boolean().optional(),
    lightContext: z.boolean().optional(),
    isolatedSession: z.boolean().optional(),
  })
  .strict()
  .optional();

const ToolPolicyBaseSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    alsoAllow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict();

export const ToolPolicySchema = ToolPolicyBaseSchema.superRefine((value, ctx) => {
  if (value.allow && value.allow.length > 0 && value.alsoAllow && value.alsoAllow.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "tools policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    });
  }
}).optional();

const TrimmedOptionalConfigStringSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const CodexAllowedDomainsSchema = z
  .array(z.string())
  .transform((values) => {
    const deduped = [
      ...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
    ];
    return deduped.length > 0 ? deduped : undefined;
  })
  .optional();

const CodexUserLocationSchema = z
  .object({
    country: TrimmedOptionalConfigStringSchema,
    region: TrimmedOptionalConfigStringSchema,
    city: TrimmedOptionalConfigStringSchema,
    timezone: TrimmedOptionalConfigStringSchema,
  })
  .strict()
  .transform((value) => {
    return value.country || value.region || value.city || value.timezone ? value : undefined;
  })
  .optional();

export const ToolsWebSearchSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.string().optional(),
    maxResults: z.number().int().positive().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    cacheTtlMinutes: z.number().nonnegative().optional(),
    apiKey: SecretInputSchema.optional().register(sensitive),
    openaiCodex: z
      .object({
        enabled: z.boolean().optional(),
        mode: z.union([z.literal("cached"), z.literal("live")]).optional(),
        allowedDomains: CodexAllowedDomainsSchema,
        contextSize: z.union([z.literal("low"), z.literal("medium"), z.literal("high")]).optional(),
        userLocation: CodexUserLocationSchema,
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

export const ToolsWebFetchSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: z.string().optional(),
    maxChars: z.number().int().positive().optional(),
    maxCharsCap: z.number().int().positive().optional(),
    maxResponseBytes: z.number().int().positive().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    cacheTtlMinutes: z.number().nonnegative().optional(),
    maxRedirects: z.number().int().nonnegative().optional(),
    userAgent: z.string().optional(),
    readability: z.boolean().optional(),
  })
  .strict()
  .optional();

export const ToolsWebSchema = z
  .object({
    search: ToolsWebSearchSchema,
    fetch: ToolsWebFetchSchema,
  })
  .strict()
  .optional();

export const ToolProfileSchema = z
  .union([z.literal("minimal"), z.literal("coding"), z.literal("messaging"), z.literal("full")])
  .optional();

type AllowlistPolicy = {
  allow?: string[];
  alsoAllow?: string[];
};

function addAllowAlsoAllowConflictIssue(
  value: AllowlistPolicy,
  ctx: z.RefinementCtx,
  message: string,
): void {
  if (value.allow && value.allow.length > 0 && value.alsoAllow && value.alsoAllow.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message,
    });
  }
}

export const ToolPolicyWithProfileSchema = z
  .object({
    allow: z.array(z.string()).optional(),
    alsoAllow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
    profile: ToolProfileSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    addAllowAlsoAllowConflictIssue(
      value,
      ctx,
      "tools.byProvider policy cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    );
  });

// Provider docking: allowlists keyed by provider id (no schema updates when adding providers).
export const ElevatedAllowFromSchema = z
  .record(z.string(), z.array(z.union([z.string(), z.number()])))
  .optional();

const ToolExecApplyPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    workspaceOnly: z.boolean().optional(),
    allowModels: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

const ToolExecSafeBinProfileSchema = z
  .object({
    minPositional: z.number().int().nonnegative().optional(),
    maxPositional: z.number().int().nonnegative().optional(),
    allowedValueFlags: z.array(z.string()).optional(),
    deniedFlags: z.array(z.string()).optional(),
  })
  .strict();

const ToolExecBaseShape = {
  host: z.enum(["auto", "gateway"]).optional(),
  security: z.enum(["deny", "allowlist", "full"]).optional(),
  ask: z.enum(["off", "on-miss", "always"]).optional(),
  pathPrepend: z.array(z.string()).optional(),
  safeBins: z.array(z.string()).optional(),
  strictInlineEval: z.boolean().optional(),
  safeBinTrustedDirs: z.array(z.string()).optional(),
  safeBinProfiles: z.record(z.string(), ToolExecSafeBinProfileSchema).optional(),
  backgroundMs: z.number().int().positive().optional(),
  timeoutSec: z.number().int().positive().optional(),
  cleanupMs: z.number().int().positive().optional(),
  notifyOnExit: z.boolean().optional(),
  notifyOnExitEmptySuccess: z.boolean().optional(),
  applyPatch: ToolExecApplyPatchSchema,
} as const;

const AgentToolExecSchema = z
  .object({
    ...ToolExecBaseShape,
    approvalRunningNoticeMs: z.number().int().nonnegative().optional(),
  })
  .strict()
  .optional();

const ToolExecSchema = z.object(ToolExecBaseShape).strict().optional();

const ToolFsSchema = z
  .object({
    workspaceOnly: z.boolean().optional(),
  })
  .strict()
  .optional();

const ToolLoopDetectionDetectorSchema = z
  .object({
    genericRepeat: z.boolean().optional(),
    knownPollNoProgress: z.boolean().optional(),
    pingPong: z.boolean().optional(),
  })
  .strict()
  .optional();

const ToolLoopDetectionSchema = z
  .object({
    enabled: z.boolean().optional(),
    historySize: z.number().int().positive().optional(),
    warningThreshold: z.number().int().positive().optional(),
    criticalThreshold: z.number().int().positive().optional(),
    globalCircuitBreakerThreshold: z.number().int().positive().optional(),
    detectors: ToolLoopDetectionDetectorSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.warningThreshold !== undefined &&
      value.criticalThreshold !== undefined &&
      value.warningThreshold >= value.criticalThreshold
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criticalThreshold"],
        message: "tools.loopDetection.warningThreshold must be lower than criticalThreshold.",
      });
    }
    if (
      value.criticalThreshold !== undefined &&
      value.globalCircuitBreakerThreshold !== undefined &&
      value.criticalThreshold >= value.globalCircuitBreakerThreshold
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["globalCircuitBreakerThreshold"],
        message:
          "tools.loopDetection.criticalThreshold must be lower than globalCircuitBreakerThreshold.",
      });
    }
  })
  .optional();

const CommonToolPolicyFields = {
  profile: ToolProfileSchema,
  allow: z.array(z.string()).optional(),
  alsoAllow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
  byProvider: z.record(z.string(), ToolPolicyWithProfileSchema).optional(),
};

export const AgentToolsSchema = z
  .object({
    ...CommonToolPolicyFields,
    elevated: z
      .object({
        enabled: z.boolean().optional(),
        allowFrom: ElevatedAllowFromSchema,
      })
      .strict()
      .optional(),
    exec: AgentToolExecSchema,
    fs: ToolFsSchema,
    loopDetection: ToolLoopDetectionSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    addAllowAlsoAllowConflictIssue(
      value,
      ctx,
      "agent tools cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    );
  })
  .optional();

export { AgentModelSchema };

const AgentRuntimeAcpSchema = z
  .object({
    agent: z.string().optional(),
    backend: z.string().optional(),
    mode: z.enum(["persistent", "oneshot"]).optional(),
    cwd: z.string().optional(),
  })
  .strict()
  .optional();

const AgentRuntimeSchema = z
  .union([
    z
      .object({
        type: z.literal("embedded"),
      })
      .strict(),
    z
      .object({
        type: z.literal("acp"),
        acp: AgentRuntimeAcpSchema,
      })
      .strict(),
  ])
  .optional();

export const AgentEntrySchema = z
  .object({
    id: z.string(),
    default: z.boolean().optional(),
    name: z.string().optional(),
    workspace: z.string().optional(),
    agentDir: z.string().optional(),
    model: AgentModelSchema.optional(),
    thinkingDefault: z
      .enum(["off", "minimal", "low", "medium", "high", "xhigh", "adaptive"])
      .optional(),
    reasoningDefault: z.enum(["on", "off", "stream"]).optional(),
    fastModeDefault: z.boolean().optional(),
    skills: z.array(z.string()).optional(),
    humanDelay: HumanDelaySchema.optional(),
    heartbeat: HeartbeatSchema,
    identity: IdentitySchema,
    groupChat: GroupChatSchema,
    subagents: z
      .object({
        allowAgents: z.array(z.string()).optional(),
        model: z
          .union([
            z.string(),
            z
              .object({
                primary: z.string().optional(),
                fallbacks: z.array(z.string()).optional(),
              })
              .strict(),
          ])
          .optional(),
        thinking: z.string().optional(),
        requireAgentId: z.boolean().optional(),
      })
      .strict()
      .optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    tools: AgentToolsSchema,
    runtime: AgentRuntimeSchema,
  })
  .strict();

export const ToolsSchema = z
  .object({
    ...CommonToolPolicyFields,
    web: ToolsWebSchema,
    media: ToolsMediaSchema,
    links: ToolsLinksSchema,
    sessions: z
      .object({
        visibility: z.enum(["self", "tree", "agent", "all"]).optional(),
      })
      .strict()
      .optional(),
    loopDetection: ToolLoopDetectionSchema,
    message: z
      .object({
        allowCrossContextSend: z.boolean().optional(),
        crossContext: z
          .object({
            allowWithinProvider: z.boolean().optional(),
            allowAcrossProviders: z.boolean().optional(),
            marker: z
              .object({
                enabled: z.boolean().optional(),
                prefix: z.string().optional(),
                suffix: z.string().optional(),
              })
              .strict()
              .optional(),
          })
          .strict()
          .optional(),
        broadcast: z
          .object({
            enabled: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    agentToAgent: z
      .object({
        enabled: z.boolean().optional(),
        allow: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    elevated: z
      .object({
        enabled: z.boolean().optional(),
        allowFrom: ElevatedAllowFromSchema,
      })
      .strict()
      .optional(),
    exec: ToolExecSchema,
    fs: ToolFsSchema,
    subagents: z
      .object({
        tools: ToolPolicySchema,
      })
      .strict()
      .optional(),
    sessions_spawn: z
      .object({
        attachments: z
          .object({
            enabled: z.boolean().optional(),
            maxTotalBytes: z.number().optional(),
            maxFiles: z.number().optional(),
            maxFileBytes: z.number().optional(),
            retainOnSessionKeep: z.boolean().optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    addAllowAlsoAllowConflictIssue(
      value,
      ctx,
      "tools cannot set both allow and alsoAllow in the same scope (merge alsoAllow into allow, or remove allow and use profile + alsoAllow)",
    );
  })
  .optional();
