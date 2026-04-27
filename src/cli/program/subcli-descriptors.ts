import type { CliTranslator } from "../i18n/types.js";

export type SubCliDescriptor = {
  name: string;
  description: string;
  descriptionKey?: string;
  hasSubcommands: boolean;
};

export const SUB_CLI_DESCRIPTORS = [
  {
    name: "acp",
    description: "Agent Control Protocol tools",
    descriptionKey: "command.acp.description",
    hasSubcommands: true,
  },
  {
    name: "gateway",
    description: "Run, inspect, and query the WebSocket Gateway",
    descriptionKey: "command.gateway.description",
    hasSubcommands: true,
  },
  {
    name: "logs",
    description: "Tail gateway file logs via RPC",
    descriptionKey: "command.logs.description",
    hasSubcommands: false,
  },
  {
    name: "system",
    description: "System events, main-session wake, and presence",
    descriptionKey: "command.system.description",
    hasSubcommands: true,
  },
  {
    name: "models",
    description: "Discover, scan, and configure models",
    descriptionKey: "command.models.description",
    hasSubcommands: true,
  },
  {
    name: "memory",
    description: "Inspect memory provider access; context details live under /context",
    descriptionKey: "command.memory.description",
    hasSubcommands: true,
  },
  {
    name: "approvals",
    description: "Manage exec approvals (gateway or node host)",
    descriptionKey: "command.approvals.description",
    hasSubcommands: true,
  },
  {
    name: "nodes",
    description: "Manage gateway node hosts; device pairing lives under devices",
    descriptionKey: "command.nodes.description",
    hasSubcommands: true,
  },
  {
    name: "devices",
    description: "Manage chat/mobile device pairing; node hosts live under nodes",
    descriptionKey: "command.devices.description",
    hasSubcommands: true,
  },
  {
    name: "node",
    description: "Run and manage the headless node host service",
    descriptionKey: "command.node.description",
    hasSubcommands: true,
  },
  {
    name: "sandbox",
    description: "Manage sandbox containers for agent isolation",
    descriptionKey: "command.sandbox.description",
    hasSubcommands: true,
  },
  {
    name: "tui",
    description: "Open a terminal UI connected to the Gateway",
    descriptionKey: "command.tui.description",
    hasSubcommands: false,
  },
  {
    name: "cron",
    description: "Manage cron jobs via the Gateway scheduler",
    descriptionKey: "command.cron.description",
    hasSubcommands: true,
  },
  {
    name: "dns",
    description: "DNS helpers for wide-area discovery (Tailscale + CoreDNS)",
    descriptionKey: "command.dns.description",
    hasSubcommands: true,
  },
  {
    name: "docs",
    description: "Search the live CrawClaw docs",
    descriptionKey: "command.docs.description",
    hasSubcommands: false,
  },
  {
    name: "hooks",
    description: "Manage internal agent hooks",
    descriptionKey: "command.hooks.description",
    hasSubcommands: true,
  },
  {
    name: "webhooks",
    description: "Webhook helpers and integrations",
    descriptionKey: "command.webhooks.description",
    hasSubcommands: true,
  },
  {
    name: "qr",
    description: "Generate iOS pairing QR/setup code",
    descriptionKey: "command.qr.description",
    hasSubcommands: false,
  },
  {
    name: "pairing",
    description: "Secure DM pairing (approve inbound requests)",
    descriptionKey: "command.pairing.description",
    hasSubcommands: true,
  },
  {
    name: "runtimes",
    description: "Install and inspect plugin runtimes; plugins manages enablement",
    descriptionKey: "command.runtimes.description",
    hasSubcommands: true,
  },
  {
    name: "plugins",
    description: "Manage plugin discovery and enablement; runtimes manages installs",
    descriptionKey: "command.plugins.description",
    hasSubcommands: true,
  },
  {
    name: "channels",
    description: "Manage channel config; health/status show runtime health",
    descriptionKey: "command.channels.description",
    hasSubcommands: true,
  },
  {
    name: "directory",
    description: "Lookup contact and group IDs (self, peers, groups) for supported chat channels",
    descriptionKey: "command.directory.description",
    hasSubcommands: true,
  },
  {
    name: "security",
    description: "Security tools and local config audits",
    descriptionKey: "command.security.description",
    hasSubcommands: true,
  },
  {
    name: "secrets",
    description: "Secrets runtime reload controls",
    descriptionKey: "command.secrets.description",
    hasSubcommands: true,
  },
  {
    name: "skills",
    description: "List and inspect skills; slash /skill runs one",
    descriptionKey: "command.skills.description",
    hasSubcommands: true,
  },
  {
    name: "update",
    description: "Update CrawClaw and inspect update channel status",
    descriptionKey: "command.update.description",
    hasSubcommands: true,
  },
  {
    name: "completion",
    description: "Generate shell completion script",
    descriptionKey: "command.completion.description",
    hasSubcommands: false,
  },
] as const satisfies ReadonlyArray<SubCliDescriptor>;

export function getSubCliEntries(): ReadonlyArray<SubCliDescriptor> {
  return SUB_CLI_DESCRIPTORS;
}

export function getSubCliCommandsWithSubcommands(): string[] {
  return SUB_CLI_DESCRIPTORS.filter((entry) => entry.hasSubcommands).map((entry) => entry.name);
}

export function localizeSubCliEntries(t: CliTranslator): ReadonlyArray<SubCliDescriptor> {
  return SUB_CLI_DESCRIPTORS.map((entry) => ({
    ...entry,
    description: t(entry.descriptionKey),
  }));
}
