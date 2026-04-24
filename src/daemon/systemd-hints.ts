import { formatCliCommand } from "../cli/command-format.js";
import {
  classifySystemdUnavailableDetail,
  type SystemdUnavailableKind,
} from "./systemd-unavailable.js";

type SystemdUnavailableHintOptions = {
  kind?: SystemdUnavailableKind | null;
  container?: boolean;
};

export function isSystemdUnavailableDetail(detail?: string): boolean {
  return classifySystemdUnavailableDetail(detail) !== null;
}

function renderSystemdHeadlessServerHints(): string[] {
  return [
    "On a headless server (SSH/no desktop session): run `sudo loginctl enable-linger $(whoami)` to persist your systemd user session across logins.",
    "Also ensure XDG_RUNTIME_DIR is set: `export XDG_RUNTIME_DIR=/run/user/$(id -u)`, then retry.",
  ];
}

export function renderSystemdUnavailableHints(
  options: SystemdUnavailableHintOptions = {},
): string[] {
  return [
    "systemd user services are unavailable; install/enable systemd or run the gateway under your supervisor.",
    ...(options.container || options.kind !== "user_bus_unavailable"
      ? []
      : renderSystemdHeadlessServerHints()),
    `If you're in a container, run the gateway in the foreground instead of \`${formatCliCommand("crawclaw gateway")}\`.`,
  ];
}
