import {
  buildDefaultBrowserClientsAllowedOrigins,
  hasConfiguredBrowserClientsAllowedOrigins,
  isGatewayNonLoopbackBindMode,
  resolveGatewayPortWithDefault,
} from "./gateway-browser-client-origins.js";
import {
  defineLegacyConfigMigration,
  getRecord,
  type LegacyConfigMigrationSpec,
  type LegacyConfigRule,
} from "./legacy.shared.js";
import { DEFAULT_GATEWAY_PORT } from "./paths.js";

function isLegacyGatewayBindHostAlias(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (
    normalized === "auto" ||
    normalized === "loopback" ||
    normalized === "lan" ||
    normalized === "tailnet" ||
    normalized === "custom"
  ) {
    return false;
  }
  return (
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "[::]" ||
    normalized === "*" ||
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function escapeControlForLog(value: string): string {
  return value.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

const GATEWAY_BIND_RULE: LegacyConfigRule = {
  path: ["gateway", "bind"],
  message:
    "gateway.bind host aliases (for example 0.0.0.0/localhost) are legacy; use bind modes (lan/loopback/custom/tailnet/auto) instead (auto-migrated on load).",
  match: (value) => isLegacyGatewayBindHostAlias(value),
  requireSourceLiteral: true,
};

const HEARTBEAT_RULE: LegacyConfigRule = {
  path: ["heartbeat"],
  message:
    "top-level heartbeat is not a valid config path; use cron for cadence or agents.defaults.heartbeat for event-driven wake settings.",
};

export const LEGACY_CONFIG_MIGRATIONS_RUNTIME: LegacyConfigMigrationSpec[] = [
  defineLegacyConfigMigration({
    // v2026.2.26 added a startup guard requiring gateway.browserClients.allowedOrigins (or the
    // host-header fallback flag) for any non-loopback bind. The setup flow was updated
    // to seed this for new installs, but existing bind=lan/bind=custom installs that upgrade
    // crash-loop immediately on next startup with no recovery path (issue #29385).
    //
    // This migration runs on every gateway start via migrateLegacyConfig → applyLegacyMigrations
    // and writes the seeded origins to disk before the startup guard fires, preventing the loop.
    id: "gateway.browserClients.allowedOrigins-seed-for-non-loopback",
    describe:
      "Seed gateway.browserClients.allowedOrigins for existing non-loopback gateway installs",
    apply: (raw, changes) => {
      const gateway = getRecord(raw.gateway);
      if (!gateway) {
        return;
      }
      const bind = gateway.bind;
      if (!isGatewayNonLoopbackBindMode(bind)) {
        return;
      }
      const browserClients = getRecord(gateway.browserClients) ?? {};
      if (
        hasConfiguredBrowserClientsAllowedOrigins({
          allowedOrigins: browserClients.allowedOrigins,
          dangerouslyAllowHostHeaderOriginFallback:
            browserClients.dangerouslyAllowHostHeaderOriginFallback,
        })
      ) {
        return;
      }
      const port = resolveGatewayPortWithDefault(gateway.port, DEFAULT_GATEWAY_PORT);
      const origins = buildDefaultBrowserClientsAllowedOrigins({
        port,
        bind,
        customBindHost:
          typeof gateway.customBindHost === "string" ? gateway.customBindHost : undefined,
      });
      gateway.browserClients = { ...browserClients, allowedOrigins: origins };
      raw.gateway = gateway;
      changes.push(
        `Seeded gateway.browserClients.allowedOrigins ${JSON.stringify(origins)} for bind=${bind}. ` +
          "Required since v2026.2.26. Add other machine origins to gateway.browserClients.allowedOrigins if needed.",
      );
    },
  }),
  defineLegacyConfigMigration({
    id: "gateway.bind.host-alias->bind-mode",
    describe: "Normalize gateway.bind host aliases to supported bind modes",
    legacyRules: [GATEWAY_BIND_RULE],
    apply: (raw, changes) => {
      const gateway = getRecord(raw.gateway);
      if (!gateway) {
        return;
      }
      const bindRaw = gateway.bind;
      if (typeof bindRaw !== "string") {
        return;
      }

      const normalized = bindRaw.trim().toLowerCase();
      let mapped: "lan" | "loopback" | undefined;
      if (
        normalized === "0.0.0.0" ||
        normalized === "::" ||
        normalized === "[::]" ||
        normalized === "*"
      ) {
        mapped = "lan";
      } else if (
        normalized === "127.0.0.1" ||
        normalized === "localhost" ||
        normalized === "::1" ||
        normalized === "[::1]"
      ) {
        mapped = "loopback";
      }

      if (!mapped || normalized === mapped) {
        return;
      }

      gateway.bind = mapped;
      raw.gateway = gateway;
      changes.push(`Normalized gateway.bind "${escapeControlForLog(bindRaw)}" → "${mapped}".`);
    },
  }),
  defineLegacyConfigMigration({
    id: "top-level-heartbeat-removed",
    describe: "Reject removed top-level heartbeat config",
    legacyRules: [HEARTBEAT_RULE],
    apply: () => {},
  }),
];
