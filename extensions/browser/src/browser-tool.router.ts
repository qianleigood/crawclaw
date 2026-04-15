import crypto from "node:crypto";

type BrowserProxyFile = {
  path: string;
  base64: string;
  mimeType?: string;
};

type BrowserProxyResult = {
  result: unknown;
  files?: BrowserProxyFile[];
};

type BrowserNodeTarget = {
  nodeId: string;
  label?: string;
};

type BrowserNodeListEntry = {
  nodeId: string;
  displayName?: string;
  remoteIp?: string;
  connected?: boolean;
  caps?: string[];
  commands?: string[];
};

export type BrowserProxyRequest = (opts: {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
}) => Promise<unknown>;

export type BrowserToolRouteDeps = {
  loadConfig: () => Record<string, unknown>;
  resolveBrowserConfig: (
    cfg: unknown,
    root: unknown,
  ) => {
    enabled: boolean;
    profiles?: Record<string, unknown>;
  };
  listNodes: (_args: Record<string, unknown>) => Promise<BrowserNodeListEntry[]>;
  resolveNodeIdFromList: (
    nodes: BrowserNodeListEntry[],
    query: string,
    allowDisconnected?: boolean,
  ) => string;
  selectDefaultNodeFromList: (
    nodes: BrowserNodeListEntry[],
    opts: { preferLocalMac: boolean; fallback: "none" | "first" },
  ) => BrowserNodeListEntry | null;
  callGatewayTool: <T = unknown>(
    toolName: string,
    opts: Record<string, unknown>,
    params?: Record<string, unknown>,
  ) => Promise<T>;
  persistBrowserProxyFiles: (files: BrowserProxyFile[] | undefined) => Promise<Map<string, string>>;
  applyBrowserProxyPaths: (result: unknown, mapping: Map<string, string>) => void;
};

const DEFAULT_BROWSER_PROXY_TIMEOUT_MS = 20_000;
const BROWSER_PROXY_GATEWAY_TIMEOUT_SLACK_MS = 5_000;

function isBrowserNode(node: BrowserNodeListEntry) {
  const caps = Array.isArray(node.caps) ? node.caps : [];
  const commands = Array.isArray(node.commands) ? node.commands : [];
  return caps.includes("browser") || commands.includes("browser.proxy");
}

async function resolveBrowserNodeTarget(params: {
  requestedNode?: string;
  target?: "sandbox" | "host" | "node";
  sandboxBridgeUrl?: string;
  deps: BrowserToolRouteDeps;
}): Promise<BrowserNodeTarget | null> {
  const cfg = params.deps.loadConfig();
  const gateway = (cfg.gateway ?? {}) as { nodes?: { browser?: Record<string, unknown> } };
  const policy = gateway.nodes?.browser ?? {};
  const mode = (policy.mode as string | undefined) ?? "auto";
  if (mode === "off") {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("Node browser proxy is disabled (gateway.nodes.browser.mode=off).");
    }
    return null;
  }
  if (params.sandboxBridgeUrl?.trim() && params.target !== "node" && !params.requestedNode) {
    return null;
  }
  if (params.target && params.target !== "node") {
    return null;
  }
  if (mode === "manual" && params.target !== "node" && !params.requestedNode) {
    return null;
  }

  const nodes = await params.deps.listNodes({});
  const browserNodes = nodes.filter((node) => node.connected && isBrowserNode(node));
  if (browserNodes.length === 0) {
    if (params.target === "node" || params.requestedNode) {
      throw new Error("No connected browser-capable nodes.");
    }
    return null;
  }

  const policyNode = typeof policy.node === "string" ? policy.node : undefined;
  const requested = params.requestedNode?.trim() || policyNode?.trim();
  if (requested) {
    const nodeId = params.deps.resolveNodeIdFromList(browserNodes, requested, false);
    const node = browserNodes.find((entry) => entry.nodeId === nodeId);
    return { nodeId, label: node?.displayName ?? node?.remoteIp ?? nodeId };
  }

  const selected = params.deps.selectDefaultNodeFromList(browserNodes, {
    preferLocalMac: false,
    fallback: "none",
  });

  if (params.target === "node") {
    if (selected) {
      return {
        nodeId: selected.nodeId,
        label: selected.displayName ?? selected.remoteIp ?? selected.nodeId,
      };
    }
    throw new Error(
      `Multiple browser-capable nodes connected (${browserNodes.length}). Set gateway.nodes.browser.node or pass node=<id>.`,
    );
  }

  if (mode === "manual") {
    return null;
  }

  if (selected) {
    return {
      nodeId: selected.nodeId,
      label: selected.displayName ?? selected.remoteIp ?? selected.nodeId,
    };
  }
  return null;
}

function resolveBrowserBaseUrl(params: {
  target?: "sandbox" | "host";
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  deps: BrowserToolRouteDeps;
}): string | undefined {
  const cfg = params.deps.loadConfig();
  const resolved = params.deps.resolveBrowserConfig((cfg as { browser?: unknown }).browser, cfg);
  const normalizedSandbox = params.sandboxBridgeUrl?.trim() ?? "";
  const target = params.target ?? (normalizedSandbox ? "sandbox" : "host");

  if (target === "sandbox") {
    if (!normalizedSandbox) {
      throw new Error(
        'Sandbox browser is unavailable. Enable agents.defaults.sandbox.browser.enabled or use target="host" if allowed.',
      );
    }
    return normalizedSandbox.replace(/\/$/, "");
  }

  if (params.allowHostControl === false) {
    throw new Error("Host browser control is disabled by sandbox policy.");
  }
  if (!resolved.enabled) {
    throw new Error(
      "Browser control is disabled. Set browser.enabled=true in ~/.crawclaw/crawclaw.json.",
    );
  }
  return undefined;
}

async function callBrowserProxy(params: {
  nodeId: string;
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs?: number;
  profile?: string;
  deps: BrowserToolRouteDeps;
}): Promise<BrowserProxyResult> {
  const proxyTimeoutMs =
    typeof params.timeoutMs === "number" && Number.isFinite(params.timeoutMs)
      ? Math.max(1, Math.floor(params.timeoutMs))
      : DEFAULT_BROWSER_PROXY_TIMEOUT_MS;
  const gatewayTimeoutMs = proxyTimeoutMs + BROWSER_PROXY_GATEWAY_TIMEOUT_SLACK_MS;
  const payload = await params.deps.callGatewayTool<{ payloadJSON?: string; payload?: string }>(
    "node.invoke",
    { timeoutMs: gatewayTimeoutMs },
    {
      nodeId: params.nodeId,
      command: "browser.proxy",
      params: {
        method: params.method,
        path: params.path,
        query: params.query,
        body: params.body,
        timeoutMs: proxyTimeoutMs,
        profile: params.profile,
      },
      idempotencyKey: crypto.randomUUID(),
    },
  );
  const parsed =
    payload?.payload ??
    (typeof payload?.payloadJSON === "string" && payload.payloadJSON
      ? (JSON.parse(payload.payloadJSON) as BrowserProxyResult)
      : null);
  if (!parsed || typeof parsed !== "object" || !("result" in parsed)) {
    throw new Error("browser proxy failed");
  }
  return parsed;
}

export async function resolveBrowserToolRoute(params: {
  profile?: string;
  requestedNode?: string;
  target?: "sandbox" | "host" | "node";
  sandboxBridgeUrl?: string;
  allowHostControl?: boolean;
  deps: BrowserToolRouteDeps;
}): Promise<{
  profile?: string;
  baseUrl?: string;
  routeKind: "host" | "sandbox" | "node";
  nodeId?: string;
  proxyRequest: BrowserProxyRequest | null;
}> {
  const requestedNode = params.requestedNode?.trim() || undefined;
  let target = params.target;
  const profile = params.profile?.trim() || undefined;

  if (requestedNode && target && target !== "node") {
    throw new Error('node is only supported with target="node".');
  }

  const nodeTarget = await resolveBrowserNodeTarget({
    requestedNode,
    target,
    sandboxBridgeUrl: params.sandboxBridgeUrl,
    deps: params.deps,
  });

  const resolvedTarget = target === "node" ? undefined : target;
  const baseUrl = nodeTarget
    ? undefined
    : resolveBrowserBaseUrl({
        target: resolvedTarget,
        sandboxBridgeUrl: params.sandboxBridgeUrl,
        allowHostControl: params.allowHostControl,
        deps: params.deps,
      });

  const proxyRequest: BrowserProxyRequest | null = nodeTarget
    ? async (request) => {
        const proxy = await callBrowserProxy({
          nodeId: nodeTarget.nodeId,
          method: request.method,
          path: request.path,
          query: request.query,
          body: request.body,
          timeoutMs: request.timeoutMs,
          profile: request.profile,
          deps: params.deps,
        });
        const mapping = await params.deps.persistBrowserProxyFiles(proxy.files);
        params.deps.applyBrowserProxyPaths(proxy.result, mapping);
        return proxy.result;
      }
    : null;

  return {
    profile,
    baseUrl,
    routeKind: nodeTarget ? "node" : baseUrl ? "sandbox" : "host",
    nodeId: nodeTarget?.nodeId,
    proxyRequest,
  };
}
