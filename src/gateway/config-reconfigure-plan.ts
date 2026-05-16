export type GatewayReconfigureOwnerId =
  | "gateway-file-noop"
  | "gateway-long-tail-config"
  | "gateway-remote-config"
  | "gateway-reload-policy"
  | "gateway-server-surface"
  | "gateway-discovery"
  | "gateway-tailscale"
  | "gateway-hooks"
  | "gateway-cron"
  | "gateway-agents-runtime"
  | "gateway-model-pricing"
  | "gateway-update"
  | "gateway-media"
  | "gateway-plugin-runtime"
  | "gateway-browser-runtime";

export type GatewayReconfigureEffect = "reconfigure" | "noop";

export type GatewayReconfigureAction =
  | "reload-server-surface"
  | "restart-health-monitor"
  | "reload-discovery"
  | "reload-tailscale"
  | "reload-hooks"
  | "restart-gmail-watcher"
  | "restart-cron"
  | "restart-heartbeat"
  | "restart-model-pricing"
  | "restart-update-check"
  | "restart-media-cleanup"
  | "reload-plugin-runtime";

export type GatewayReconfigureOwner = {
  id: GatewayReconfigureOwnerId;
  prefixes: string[];
  effect: GatewayReconfigureEffect;
  actions?: GatewayReconfigureAction[];
};

export type GatewayReconfigurePlan = {
  changedPaths: string[];
  restartGateway: boolean;
  restartReasons: string[];
  hotReasons: string[];
  noopPaths: string[];
  unmatchedPaths: string[];
  ownerIds: GatewayReconfigureOwnerId[];
  actions: Set<GatewayReconfigureAction>;
};

const BASE_RECONFIGURE_OWNERS: GatewayReconfigureOwner[] = [
  {
    id: "gateway-file-noop",
    prefixes: ["$schema", "meta", "wizard", "cli", "logging"],
    effect: "noop",
  },
  {
    id: "gateway-remote-config",
    prefixes: ["gateway.remote"],
    effect: "noop",
  },
  {
    id: "gateway-reload-policy",
    prefixes: ["gateway.reload"],
    effect: "noop",
  },
  {
    id: "gateway-tailscale",
    prefixes: ["gateway.tailscale"],
    effect: "reconfigure",
    actions: ["reload-tailscale"],
  },
  {
    id: "gateway-server-surface",
    prefixes: [
      "gateway.port",
      "gateway.mode",
      "gateway.bind",
      "gateway.customBindHost",
      "gateway.browserClients",
      "gateway.auth",
      "gateway.trustedProxies",
      "gateway.allowRealIpFallback",
      "gateway.tls",
      "gateway.http",
      "gateway.tools",
      "gateway.webchat",
      "gateway",
    ],
    effect: "reconfigure",
    actions: ["reload-server-surface", "reload-discovery", "reload-tailscale"],
  },
  {
    id: "gateway-discovery",
    prefixes: ["discovery"],
    effect: "reconfigure",
    actions: ["reload-discovery"],
  },
  {
    id: "gateway-hooks",
    prefixes: ["hooks.gmail"],
    effect: "reconfigure",
    actions: ["reload-hooks", "restart-gmail-watcher"],
  },
  {
    id: "gateway-hooks",
    prefixes: ["hooks"],
    effect: "reconfigure",
    actions: ["reload-hooks"],
  },
  {
    id: "gateway-cron",
    prefixes: ["cron"],
    effect: "reconfigure",
    actions: ["restart-cron"],
  },
  {
    id: "gateway-agents-runtime",
    prefixes: ["agents", "auth", "models"],
    effect: "reconfigure",
    actions: ["restart-heartbeat"],
  },
  {
    id: "gateway-model-pricing",
    prefixes: ["models"],
    effect: "reconfigure",
    actions: ["restart-heartbeat", "restart-model-pricing"],
  },
  {
    id: "gateway-update",
    prefixes: ["update"],
    effect: "reconfigure",
    actions: ["restart-update-check"],
  },
  {
    id: "gateway-media",
    prefixes: ["media"],
    effect: "reconfigure",
    actions: ["restart-media-cleanup"],
  },
  {
    id: "gateway-plugin-runtime",
    prefixes: ["plugins"],
    effect: "reconfigure",
    actions: ["reload-plugin-runtime"],
  },
  {
    id: "gateway-browser-runtime",
    prefixes: ["browser"],
    effect: "noop",
  },
  {
    id: "gateway-long-tail-config",
    prefixes: [
      "acp",
      "approvals",
      "bindings",
      "broadcast",
      "commands",
      "diagnostics",
      "env",
      "mcp",
      "memory",
      "messages",
      "secrets",
      "session",
      "skills",
      "talk",
      "tools",
      "workflow",
    ],
    effect: "noop",
  },
];

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}.`);
}

export function listGatewayReconfigureOwners(): GatewayReconfigureOwner[] {
  return BASE_RECONFIGURE_OWNERS;
}

function matchOwners(path: string): GatewayReconfigureOwner[] {
  const best: GatewayReconfigureOwner[] = [];
  let bestPrefixLength = -1;
  for (const owner of listGatewayReconfigureOwners()) {
    for (const prefix of owner.prefixes) {
      if (!matchesPrefix(path, prefix)) {
        continue;
      }
      if (prefix.length > bestPrefixLength) {
        best.length = 0;
        best.push(owner);
        bestPrefixLength = prefix.length;
        continue;
      }
      if (prefix.length === bestPrefixLength) {
        best.push(owner);
      }
    }
  }
  return best;
}

function orderedOwnerIds(ids: Set<GatewayReconfigureOwnerId>): GatewayReconfigureOwnerId[] {
  const order = new Map<GatewayReconfigureOwnerId, number>();
  for (const [index, owner] of BASE_RECONFIGURE_OWNERS.entries()) {
    if (!order.has(owner.id)) {
      order.set(owner.id, index);
    }
  }
  return [...ids].toSorted((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

export function buildGatewayReconfigurePlan(changedPaths: string[]): GatewayReconfigurePlan {
  const ownerIds = new Set<GatewayReconfigureOwnerId>();
  const actions = new Set<GatewayReconfigureAction>();
  const plan: GatewayReconfigurePlan = {
    changedPaths,
    restartGateway: false,
    restartReasons: [],
    hotReasons: [],
    noopPaths: [],
    unmatchedPaths: [],
    ownerIds: [],
    actions,
  };

  for (const path of changedPaths) {
    const owners = matchOwners(path);
    if (owners.length === 0) {
      plan.restartGateway = true;
      plan.restartReasons.push(path);
      plan.unmatchedPaths.push(path);
      continue;
    }

    for (const owner of owners) {
      ownerIds.add(owner.id);
    }
    if (owners.every((owner) => owner.effect === "noop")) {
      plan.noopPaths.push(path);
      continue;
    }

    plan.hotReasons.push(path);
    for (const owner of owners) {
      if (owner.effect === "noop") {
        continue;
      }
      for (const action of owner.actions ?? []) {
        actions.add(action);
      }
    }
  }

  if (actions.has("restart-gmail-watcher")) {
    actions.add("reload-hooks");
  }

  plan.ownerIds = orderedOwnerIds(ownerIds);
  return plan;
}
