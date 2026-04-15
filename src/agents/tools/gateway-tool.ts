import { Type } from "@sinclair/typebox";
import { isRestartEnabled } from "../../config/commands.js";
import type { CrawClawConfig } from "../../config/config.js";
import { parseConfigJson5, resolveConfigSnapshotHash } from "../../config/io.js";
import { applyLegacyMigrations } from "../../config/legacy.js";
import { applyMergePatch } from "../../config/merge-patch.js";
import { extractDeliveryInfo } from "../../config/sessions.js";
import {
  formatDoctorNonInteractiveHint,
  type RestartSentinelPayload,
  writeRestartSentinel,
} from "../../infra/restart-sentinel.js";
import { scheduleGatewaySigusr1Restart } from "../../infra/restart.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions } from "./gateway.js";
import {
  applyGatewayConfig,
  getGatewayConfigSnapshot,
  lookupGatewayConfigSchema,
  patchGatewayConfig,
  resolveGatewayConfigWriteParams,
  runGatewayUpdate,
} from "./gateway-tool-ops.js";

const log = createSubsystemLogger("gateway-tool");
const PROTECTED_GATEWAY_CONFIG_PATHS = ["tools.exec.ask", "tools.exec.security"] as const;

function resolveBaseHashFromSnapshot(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") {
    return undefined;
  }
  const hashValue = (snapshot as { hash?: unknown }).hash;
  const rawValue = (snapshot as { raw?: unknown }).raw;
  const hash = resolveConfigSnapshotHash({
    hash: typeof hashValue === "string" ? hashValue : undefined,
    raw: typeof rawValue === "string" ? rawValue : undefined,
  });
  return hash ?? undefined;
}

function getSnapshotConfig(snapshot: unknown): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== "object") {
    throw new Error("config.get response is not an object.");
  }
  const config = (snapshot as { config?: unknown }).config;
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error("config.get response is missing a config object.");
  }
  return config as Record<string, unknown>;
}

function parseGatewayConfigMutationRaw(
  raw: string,
  action: "config.apply" | "config.patch",
): unknown {
  const parsedRes = parseConfigJson5(raw);
  if (!parsedRes.ok) {
    throw new Error(parsedRes.error);
  }
  if (
    !parsedRes.parsed ||
    typeof parsedRes.parsed !== "object" ||
    Array.isArray(parsedRes.parsed)
  ) {
    throw new Error(`${action} raw must be an object.`);
  }
  return parsedRes.parsed;
}

function getValueAtPath(config: Record<string, unknown>, path: string): unknown {
  let current: unknown = config;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function assertGatewayConfigMutationAllowed(params: {
  action: "config.apply" | "config.patch";
  currentConfig: Record<string, unknown>;
  raw: string;
}): void {
  const parsed = parseGatewayConfigMutationRaw(params.raw, params.action);
  const nextConfig =
    params.action === "config.apply"
      ? (parsed as Record<string, unknown>)
      : (applyMergePatch(params.currentConfig, parsed, {
          mergeObjectArraysById: true,
        }) as Record<string, unknown>);
  const migratedNextConfig = applyLegacyMigrations(nextConfig).next ?? nextConfig;
  const changedProtectedPaths = PROTECTED_GATEWAY_CONFIG_PATHS.filter(
    (path) =>
      getValueAtPath(params.currentConfig, path) !== getValueAtPath(migratedNextConfig, path),
  );
  if (changedProtectedPaths.length === 0) {
    return;
  }
  throw new Error(
    `gateway ${params.action} cannot change protected config paths: ${changedProtectedPaths.join(", ")}`,
  );
}

const GATEWAY_ACTIONS = [
  "restart",
  "config.get",
  "config.schema.lookup",
  "config.apply",
  "config.patch",
  "update.run",
] as const;

// NOTE: Using a flattened object schema instead of Type.Union([Type.Object(...), ...])
// because Claude API on Vertex AI rejects nested anyOf schemas as invalid JSON Schema.
// The discriminator (action) determines which properties are relevant; runtime validates.
const GatewayToolSchema = Type.Object({
  action: stringEnum(GATEWAY_ACTIONS),
  // restart
  delayMs: Type.Optional(Type.Number()),
  reason: Type.Optional(Type.String()),
  // config.get, config.schema.lookup, config.apply, update.run
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
  // config.schema.lookup
  path: Type.Optional(Type.String()),
  // config.apply, config.patch
  raw: Type.Optional(Type.String()),
  baseHash: Type.Optional(Type.String()),
  // config.apply, config.patch, update.run
  sessionKey: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
  restartDelayMs: Type.Optional(Type.Number()),
});
// NOTE: We intentionally avoid top-level `allOf`/`anyOf`/`oneOf` conditionals here:
// - OpenAI rejects tool schemas that include these keywords at the *top-level*.
// - Claude/Vertex has other JSON Schema quirks.
// Conditional requirements (like `raw` for config.apply) are enforced at runtime.

export function createGatewayTool(opts?: {
  agentSessionKey?: string;
  config?: CrawClawConfig;
}): AnyAgentTool {
  return {
    label: "Gateway",
    name: "gateway",
    ownerOnly: true,
    description:
      "Restart, inspect a specific config schema path, apply config, or update the gateway in-place (SIGUSR1). Use config.schema.lookup with a targeted dot path before config edits. Use config.patch for safe partial config updates (merges with existing). Use config.apply only when replacing entire config. Both trigger restart after writing. Always pass a human-readable completion message via the `note` parameter so the system can deliver it to the user after restart.",
    parameters: GatewayToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      if (action === "restart") {
        if (!isRestartEnabled(opts?.config)) {
          throw new Error("Gateway restart is disabled (commands.restart=false).");
        }
        const sessionKey =
          typeof params.sessionKey === "string" && params.sessionKey.trim()
            ? params.sessionKey.trim()
            : opts?.agentSessionKey?.trim() || undefined;
        const delayMs =
          typeof params.delayMs === "number" && Number.isFinite(params.delayMs)
            ? Math.floor(params.delayMs)
            : undefined;
        const reason =
          typeof params.reason === "string" && params.reason.trim()
            ? params.reason.trim().slice(0, 200)
            : undefined;
        const note =
          typeof params.note === "string" && params.note.trim() ? params.note.trim() : undefined;
        // Extract channel + threadId for routing after restart.
        // Uses generic :thread: parsing plus plugin-owned session grammars.
        const { deliveryContext, threadId } = extractDeliveryInfo(sessionKey);
        const payload: RestartSentinelPayload = {
          kind: "restart",
          status: "ok",
          ts: Date.now(),
          sessionKey,
          deliveryContext,
          threadId,
          message: note ?? reason ?? null,
          doctorHint: formatDoctorNonInteractiveHint(),
          stats: {
            mode: "gateway.restart",
            reason,
          },
        };
        try {
          await writeRestartSentinel(payload);
        } catch {
          // ignore: sentinel is best-effort
        }
        log.info(
          `gateway tool: restart requested (delayMs=${delayMs ?? "default"}, reason=${reason ?? "none"})`,
        );
        const scheduled = scheduleGatewaySigusr1Restart({
          delayMs,
          reason,
        });
        return jsonResult(scheduled);
      }

      const gatewayOpts = readGatewayCallOptions(params);

      if (action === "config.get") {
        const result = await getGatewayConfigSnapshot(callGatewayTool, gatewayOpts);
        return jsonResult({ ok: true, result });
      }
      if (action === "config.schema.lookup") {
        const path = readStringParam(params, "path", {
          required: true,
          label: "path",
        });
        const result = await lookupGatewayConfigSchema(callGatewayTool, gatewayOpts, path);
        return jsonResult({ ok: true, result });
      }
      if (action === "config.apply") {
        const { raw, baseHash, snapshotConfig, sessionKey, note, restartDelayMs } =
          await resolveGatewayConfigWriteParams({
            input: params,
            gatewayOpts,
            agentSessionKey: opts?.agentSessionKey,
            callGateway: callGatewayTool,
            resolveBaseHashFromSnapshot,
            getSnapshotConfig,
          });
        assertGatewayConfigMutationAllowed({
          action: "config.apply",
          currentConfig: snapshotConfig,
          raw,
        });
        const result = await applyGatewayConfig(callGatewayTool, gatewayOpts, {
          raw,
          baseHash,
          sessionKey,
          note,
          restartDelayMs,
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "config.patch") {
        const { raw, baseHash, snapshotConfig, sessionKey, note, restartDelayMs } =
          await resolveGatewayConfigWriteParams({
            input: params,
            gatewayOpts,
            agentSessionKey: opts?.agentSessionKey,
            callGateway: callGatewayTool,
            resolveBaseHashFromSnapshot,
            getSnapshotConfig,
          });
        assertGatewayConfigMutationAllowed({
          action: "config.patch",
          currentConfig: snapshotConfig,
          raw,
        });
        const result = await patchGatewayConfig(callGatewayTool, gatewayOpts, {
          raw,
          baseHash,
          sessionKey,
          note,
          restartDelayMs,
        });
        return jsonResult({ ok: true, result });
      }
      if (action === "update.run") {
        const result = await runGatewayUpdate(callGatewayTool, {
          input: params,
          gatewayOpts,
          agentSessionKey: opts?.agentSessionKey,
        });
        return jsonResult({ ok: true, result });
      }

      throw new Error(`Unknown action: ${action}`);
    },
  };
}
