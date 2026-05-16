import type { IncomingMessage, ServerResponse } from "node:http";
import { loadConfig } from "../config/config.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import {
  readJsonBodyOrError,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-common.js";
import {
  authorizeGatewayHttpRequestOrReply,
  resolveOpenAiCompatibleHttpOperatorScopes,
} from "./http-utils.js";
import { authorizeOperatorScopesForMethod } from "./method-scopes.js";

const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;
const WORKFLOW_AGENT_HTTP_PATH = "/workflows/agent/run";

function hasNonEmptyStringField(value: Record<string, unknown>, names: string[]): boolean {
  return names.some((name) => typeof value[name] === "string" && value[name].trim().length > 0);
}

function validateWorkflowAgentRunParams(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const params = value as Record<string, unknown>;
  const workspaceBinding = params.workspaceBinding;
  const hasWorkspaceBinding =
    !!workspaceBinding &&
    typeof workspaceBinding === "object" &&
    !Array.isArray(workspaceBinding) &&
    hasNonEmptyStringField(workspaceBinding as Record<string, unknown>, [
      "workspaceDir",
      "agentDir",
    ]);
  return (
    hasNonEmptyStringField(params, ["workflowId", "workflow"]) &&
    hasNonEmptyStringField(params, ["executionId"]) &&
    hasNonEmptyStringField(params, ["stepId"]) &&
    hasNonEmptyStringField(params, ["goal", "message", "task"]) &&
    hasWorkspaceBinding
  );
}

export async function handleWorkflowAgentHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    maxBodyBytes?: number;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== WORKFLOW_AGENT_HTTP_PATH) {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const cfg = loadConfig();
  const requestAuth = await authorizeGatewayHttpRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback ?? cfg.gateway?.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!requestAuth) {
    return true;
  }

  const requestedScopes = resolveOpenAiCompatibleHttpOperatorScopes(req, requestAuth);
  const scopeAuth = authorizeOperatorScopesForMethod("workflow.agent.run", requestedScopes);
  if (!scopeAuth.allowed) {
    sendJson(res, 403, {
      ok: false,
      error: {
        type: "forbidden",
        message: `missing scope: ${scopeAuth.missingScope}`,
      },
    });
    return true;
  }

  const bodyUnknown = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  if (bodyUnknown === undefined) {
    return true;
  }

  if (!validateWorkflowAgentRunParams(bodyUnknown)) {
    sendInvalidRequest(
      res,
      "workflow agent run requires workflowId, executionId, stepId, goal, and workspaceBinding.workspaceDir or workspaceBinding.agentDir",
    );
    return true;
  }

  sendJson(res, 503, {
    ok: false,
    error: {
      type: "unavailable",
      message: "workflow.agent.run is handled by the Rust Gateway runtime.",
    },
  });
  return true;
}
