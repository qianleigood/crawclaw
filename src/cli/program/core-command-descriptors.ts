import type { CliTranslator } from "../i18n/types.js";

export type CoreCliCommandDescriptor = {
  name: string;
  description: string;
  descriptionKey?: string;
  hasSubcommands: boolean;
};

export const CORE_CLI_COMMAND_DESCRIPTORS = [
  {
    name: "setup",
    description: "Initialize local config and agent workspace",
    descriptionKey: "command.setup.description",
    hasSubcommands: false,
  },
  {
    name: "onboard",
    description: "Interactive onboarding for gateway, workspace, and skills",
    descriptionKey: "command.onboard.description",
    hasSubcommands: false,
  },
  {
    name: "configure",
    description: "Interactive configuration for credentials, channels, gateway, and agent defaults",
    descriptionKey: "command.configure.description",
    hasSubcommands: false,
  },
  {
    name: "config",
    description:
      "Non-interactive config helpers (get/set/unset/file/validate). Default: starts guided setup.",
    descriptionKey: "command.config.description",
    hasSubcommands: true,
  },
  {
    name: "backup",
    description: "Create and verify local backup archives for CrawClaw state",
    descriptionKey: "command.backup.description",
    hasSubcommands: true,
  },
  {
    name: "migrate-crawclaw",
    description: "One-time migration of legacy CrawClaw state into CrawClaw runtime paths",
    descriptionKey: "command.migrate-crawclaw.description",
    hasSubcommands: false,
  },
  {
    name: "doctor",
    description: "Health checks + quick fixes for the gateway and channels",
    descriptionKey: "command.doctor.description",
    hasSubcommands: false,
  },
  {
    name: "reset",
    description: "Reset local config/state (keeps the CLI installed)",
    descriptionKey: "command.reset.description",
    hasSubcommands: false,
  },
  {
    name: "uninstall",
    description: "Uninstall the gateway service + local data (CLI remains)",
    descriptionKey: "command.uninstall.description",
    hasSubcommands: false,
  },
  {
    name: "message",
    description: "Send, read, and manage messages",
    descriptionKey: "command.message.description",
    hasSubcommands: true,
  },
  {
    name: "agent",
    description: "Run one agent turn via the Gateway",
    descriptionKey: "command.agent.description",
    hasSubcommands: false,
  },
  {
    name: "agents",
    description: "Manage isolated agents (workspaces, auth, routing)",
    descriptionKey: "command.agents.description",
    hasSubcommands: true,
  },
  {
    name: "status",
    description: "Show channel health and recent session recipients",
    descriptionKey: "command.status.description",
    hasSubcommands: false,
  },
  {
    name: "health",
    description: "Fetch health from the running gateway",
    descriptionKey: "command.health.description",
    hasSubcommands: false,
  },
  {
    name: "sessions",
    description: "List stored conversation sessions",
    descriptionKey: "command.sessions.description",
    hasSubcommands: true,
  },
  {
    name: "tasks",
    description: "Inspect durable background task state",
    descriptionKey: "command.tasks.description",
    hasSubcommands: true,
  },
] as const satisfies ReadonlyArray<CoreCliCommandDescriptor>;

export function getCoreCliCommandDescriptors(): ReadonlyArray<CoreCliCommandDescriptor> {
  return CORE_CLI_COMMAND_DESCRIPTORS;
}

export function getCoreCliCommandsWithSubcommands(): string[] {
  return CORE_CLI_COMMAND_DESCRIPTORS.filter((command) => command.hasSubcommands).map(
    (command) => command.name,
  );
}

export function localizeCoreCliCommandDescriptors(
  t: CliTranslator,
): ReadonlyArray<CoreCliCommandDescriptor> {
  return CORE_CLI_COMMAND_DESCRIPTORS.map((command) => ({
    ...command,
    description: t(command.descriptionKey),
  }));
}
