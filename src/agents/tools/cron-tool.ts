import { loadConfig } from "../../config/config.js";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import {
  addCronJob,
  getCronStatus,
  listCronJobs,
  listCronRuns,
  readCronJobId,
  readCronRunMode,
  readCronWakeMode,
  removeCronJob,
  resolveCronGatewayOptions,
  runCronJob,
  type CronGatewayCaller,
  updateCronJob,
  wakeGateway,
} from "./cron-gateway.js";
import { CronToolSchema, recoverFlatCronObject } from "./cron-tool-params.js";
export { CronToolSchema } from "./cron-tool-params.js";
import {
  appendReminderContextToPayload,
  normalizeAgentTurnCronDelivery,
} from "./cron-tool-runtime.js";
import { callGatewayTool } from "./gateway.js";
import { resolveInternalSessionKey, resolveMainSessionAlias } from "./sessions-helpers.js";

type CronToolOptions = {
  agentSessionKey?: string;
};

type CronToolDeps = {
  callGatewayTool?: CronGatewayCaller;
};

export function createCronTool(opts?: CronToolOptions, deps?: CronToolDeps): AnyAgentTool {
  const callGateway = deps?.callGatewayTool ?? callGatewayTool;
  return {
    label: "Cron",
    name: "cron",
    ownerOnly: true,
    displaySummary: "Schedule and manage cron jobs and wake events.",
    description: `Manage Gateway cron jobs (status/list/add/update/remove/run/runs) and send wake events.

Main-session cron jobs enqueue system events for main-session handling. Isolated cron jobs create background task runs that appear in \`crawclaw tasks\`.

ACTIONS:
- status: Check cron scheduler status
- list: List jobs (use includeDisabled:true to include disabled)
- add: Create job (requires job object, see schema below)
- update: Modify job (requires jobId + patch object)
- remove: Delete job (requires jobId)
- run: Trigger job immediately (requires jobId)
- runs: Get job run history (requires jobId)
- wake: Send wake event (requires text, optional mode)

JOB SCHEMA (for add action):
{
  "name": "string (optional)",
  "schedule": { ... },      // Required: when to run
  "payload": { ... },       // Required: what to execute
  "delivery": { ... },      // Optional: announce summary (isolated/current/session:xxx only) or webhook POST
  "sessionTarget": "main" | "isolated" | "current" | "session:<custom-id>",  // Optional, defaults based on context
  "enabled": true | false   // Optional, default true
}

SESSION TARGET OPTIONS:
- "main": Run in the main session (requires payload.kind="systemEvent")
- "isolated": Run in an ephemeral isolated session (requires payload.kind="agentTurn")
- "current": Bind to the current session where the cron is created (resolved at creation time)
- "session:<custom-id>": Run in a persistent named session (e.g., "session:project-alpha-daily")

DEFAULT BEHAVIOR (unchanged for backward compatibility):
- payload.kind="systemEvent" → defaults to "main"
- payload.kind="agentTurn" → defaults to "isolated"
To use current session binding, explicitly set sessionTarget="current".

SCHEDULE TYPES (schedule.kind):
- "at": One-shot at absolute time
  { "kind": "at", "at": "<ISO-8601 timestamp>" }
- "every": Recurring interval
  { "kind": "every", "everyMs": <interval-ms>, "anchorMs": <optional-start-ms> }
- "cron": Cron expression
  { "kind": "cron", "expr": "<cron-expression>", "tz": "<optional-timezone>" }

ISO timestamps without an explicit timezone are treated as UTC.

PAYLOAD TYPES (payload.kind):
- "systemEvent": Injects text as system event into session
  { "kind": "systemEvent", "text": "<message>" }
- "agentTurn": Runs agent with message (isolated sessions only)
  { "kind": "agentTurn", "message": "<prompt>", "model": "<optional>", "thinking": "<optional>", "timeoutSeconds": <optional, 0 means no timeout> }

DELIVERY (top-level):
  { "mode": "none|announce|webhook", "channel": "<optional>", "to": "<optional>", "bestEffort": <optional-bool> }
  - Default for isolated agentTurn jobs (when delivery omitted): "announce"
  - announce: send to chat channel (optional channel/to target)
  - webhook: send finished-run event as HTTP POST to delivery.to (URL required)
  - If the task needs to send to a specific chat/recipient, set announce delivery.channel/to; do not call messaging tools inside the run.

CRITICAL CONSTRAINTS:
- sessionTarget="main" REQUIRES payload.kind="systemEvent"
- sessionTarget="isolated" | "current" | "session:xxx" REQUIRES payload.kind="agentTurn"
- For webhook callbacks, use delivery.mode="webhook" with delivery.to set to a URL.
Default: prefer isolated agentTurn jobs unless the user explicitly wants current-session binding.

WAKE MODES (for wake action):
- "next-heartbeat" (default): Queue the next main-session wake
- "now": Wake immediately

Use jobId as the canonical identifier; id is accepted for compatibility. Use contextMessages (0-10) to add previous messages as context to the job text.`,
    parameters: CronToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const gatewayOpts = resolveCronGatewayOptions(params);

      switch (action) {
        case "status":
          return jsonResult(await getCronStatus(callGateway, gatewayOpts));
        case "list":
          return jsonResult(
            await listCronJobs(callGateway, gatewayOpts, Boolean(params.includeDisabled)),
          );
        case "add": {
          recoverFlatCronObject(params, "job");

          if (!params.job || typeof params.job !== "object") {
            throw new Error("job required");
          }
          const job =
            normalizeCronJobCreate(params.job, {
              sessionContext: { sessionKey: opts?.agentSessionKey },
            }) ?? params.job;
          if (job && typeof job === "object") {
            const cfg = loadConfig();
            const { mainKey, alias } = resolveMainSessionAlias(cfg);
            const resolvedSessionKey = opts?.agentSessionKey
              ? resolveInternalSessionKey({ key: opts.agentSessionKey, alias, mainKey })
              : undefined;
            if (!("agentId" in job)) {
              const agentId = opts?.agentSessionKey
                ? resolveSessionAgentId({ sessionKey: opts.agentSessionKey, config: cfg })
                : undefined;
              if (agentId) {
                (job as { agentId?: string }).agentId = agentId;
              }
            }
            if (!("sessionKey" in job) && resolvedSessionKey) {
              (job as { sessionKey?: string }).sessionKey = resolvedSessionKey;
            }
          }

          if (
            opts?.agentSessionKey &&
            job &&
            typeof job === "object" &&
            "payload" in job &&
            (job as { payload?: { kind?: string } }).payload?.kind === "agentTurn"
          ) {
            const nextDelivery = normalizeAgentTurnCronDelivery({
              deliveryValue: (job as { delivery?: unknown }).delivery,
              agentSessionKey: opts.agentSessionKey,
            });
            if (nextDelivery !== undefined) {
              (job as { delivery?: unknown }).delivery = nextDelivery;
            }
          }

          const contextMessages =
            typeof params.contextMessages === "number" && Number.isFinite(params.contextMessages)
              ? params.contextMessages
              : 0;
          if (
            job &&
            typeof job === "object" &&
            "payload" in job &&
            (job as { payload?: { kind?: string; text?: string } }).payload?.kind === "systemEvent"
          ) {
            const payload = (job as { payload: { kind: string; text: string } }).payload;
            await appendReminderContextToPayload({
              payload,
              agentSessionKey: opts?.agentSessionKey,
              gatewayOpts,
              contextMessages,
              callGatewayTool: callGateway,
            });
          }
          return jsonResult(await addCronJob(callGateway, gatewayOpts, job));
        }
        case "update": {
          const id = readCronJobId(params);

          const { recovered: recoveredFlatPatch } = recoverFlatCronObject(params, "patch");

          if (!params.patch || typeof params.patch !== "object") {
            throw new Error("patch required");
          }
          const patch = normalizeCronJobPatch(params.patch) ?? params.patch;
          if (
            recoveredFlatPatch &&
            typeof patch === "object" &&
            patch !== null &&
            Object.keys(patch as Record<string, unknown>).length === 0
          ) {
            throw new Error("patch required");
          }
          return jsonResult(await updateCronJob(callGateway, gatewayOpts, id, patch));
        }
        case "remove": {
          return jsonResult(await removeCronJob(callGateway, gatewayOpts, readCronJobId(params)));
        }
        case "run": {
          return jsonResult(
            await runCronJob(
              callGateway,
              gatewayOpts,
              readCronJobId(params),
              readCronRunMode(params),
            ),
          );
        }
        case "runs": {
          return jsonResult(await listCronRuns(callGateway, gatewayOpts, readCronJobId(params)));
        }
        case "wake": {
          const text = readStringParam(params, "text", { required: true });
          return jsonResult(
            await wakeGateway(callGateway, gatewayOpts, readCronWakeMode(params), text),
          );
        }
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    },
  };
}
