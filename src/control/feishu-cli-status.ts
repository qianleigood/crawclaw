import type { CrawClawConfig } from "../config/types.js";

export type FeishuCliStatusSnapshot = {
  identity?: "user";
  enabled?: boolean;
  command?: string;
  profile?: string;
  timeoutMs?: number;
  installed?: boolean;
  version?: string;
  authOk?: boolean;
  status?: "ready" | "not_configured" | "error" | "disabled";
  message?: string;
  hint?: string;
  raw?: unknown;
};

export type FeishuCliStatusResolution = {
  supported: boolean;
  status: FeishuCliStatusSnapshot | null;
  error: string | null;
};

type GatewayCaller = typeof import("../gateway/call.js").callGateway;

function formatUnknownErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "number" || typeof err === "boolean" || typeof err === "bigint") {
    return String(err);
  }
  if (err == null) {
    return "";
  }
  if (typeof err === "object") {
    const message = Reflect.get(err, "message");
    if (typeof message === "string") {
      return message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return "unknown error";
    }
  }
  return "";
}

export function isUnknownGatewayMethodError(err: unknown, method: string): boolean {
  const message = formatUnknownErrorMessage(err);
  return message.includes(`unknown method: ${method}`);
}

export async function resolveFeishuCliStatusViaGateway(params: {
  callGateway: GatewayCaller;
  config?: CrawClawConfig;
  gatewayReachable: boolean;
  timeoutMs: number;
  callOverrides?: {
    url?: string;
    token?: string;
    password?: string;
  };
}): Promise<FeishuCliStatusResolution | null> {
  if (!params.gatewayReachable) {
    return null;
  }
  try {
    const status = await params.callGateway<FeishuCliStatusSnapshot>({
      ...(params.config ? { config: params.config } : {}),
      method: "feishu.cli.status",
      params: { verify: false },
      timeoutMs: params.timeoutMs,
      ...params.callOverrides,
    });
    return {
      supported: true,
      status,
      error: null,
    };
  } catch (err) {
    if (isUnknownGatewayMethodError(err, "feishu.cli.status")) {
      return {
        supported: false,
        status: null,
        error: null,
      };
    }
    return {
      supported: true,
      status: null,
      error: formatUnknownErrorMessage(err),
    };
  }
}
