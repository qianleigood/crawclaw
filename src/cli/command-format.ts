import { replaceCliName, resolveCliName } from "./cli-name.js";
import { normalizeProfileName } from "./profile-utils.js";

const CLI_PREFIX_RE = /^(?:pnpm|npm|bunx|npx)\s+(?:crawclaw|crawclaw)\b|^(?:crawclaw|crawclaw)\b/;
const PROFILE_FLAG_RE = /(?:^|\s)--profile(?:\s|=|$)/;
const DEV_FLAG_RE = /(?:^|\s)--dev(?:\s|$)/;

export function formatCliCommand(
  command: string,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string {
  const cliName = resolveCliName();
  const normalizedCommand = replaceCliName(command, cliName);
  const profile = normalizeProfileName(env.CRAWCLAW_PROFILE);
  if (!profile) {
    return normalizedCommand;
  }
  if (!CLI_PREFIX_RE.test(normalizedCommand)) {
    return normalizedCommand;
  }
  const additions: string[] = [];
  if (profile && !PROFILE_FLAG_RE.test(normalizedCommand) && !DEV_FLAG_RE.test(normalizedCommand)) {
    additions.push(`--profile ${profile}`);
  }
  if (additions.length === 0) {
    return normalizedCommand;
  }
  return normalizedCommand.replace(CLI_PREFIX_RE, (match) => `${match} ${additions.join(" ")}`);
}
