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
};

function resolveBrowserBaseUrl(params: {
  allowHostControl?: boolean;
  deps: BrowserToolRouteDeps;
}): string | undefined {
  const cfg = params.deps.loadConfig();
  const resolved = params.deps.resolveBrowserConfig((cfg as { browser?: unknown }).browser, cfg);

  if (params.allowHostControl === false) {
    throw new Error("Host browser control is disabled by policy.");
  }
  if (!resolved.enabled) {
    throw new Error(
      "Browser control is disabled. Set browser.enabled=true in ~/.crawclaw/crawclaw.json.",
    );
  }
  return undefined;
}

export async function resolveBrowserToolRoute(params: {
  profile?: string;
  requestedNode?: string;
  target?: "host" | "node";
  allowHostControl?: boolean;
  deps: BrowserToolRouteDeps;
}): Promise<{
  profile?: string;
  baseUrl?: string;
  routeKind: "host";
  proxyRequest: BrowserProxyRequest | null;
}> {
  const requestedNode = params.requestedNode?.trim() || undefined;
  if (requestedNode || params.target === "node") {
    throw new Error('Node browser proxy is no longer supported. Use target="host".');
  }

  return {
    profile: params.profile?.trim() || undefined,
    baseUrl: resolveBrowserBaseUrl({
      allowHostControl: params.allowHostControl,
      deps: params.deps,
    }),
    routeKind: "host",
    proxyRequest: null,
  };
}
