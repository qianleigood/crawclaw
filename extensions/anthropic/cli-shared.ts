export const CLAUDE_CLI_BACKEND_ID = "claude-cli";

export function isClaudeCliProvider(providerId: string): boolean {
  return providerId.trim().toLowerCase() === CLAUDE_CLI_BACKEND_ID;
}
