export const CRAWCLAW_CLI_ENV_VAR = "CRAWCLAW_CLI";
export const CRAWCLAW_CLI_ENV_VALUE = "1";

export function markCrawClawExecEnv<T extends Record<string, string | undefined>>(env: T): T {
  return {
    ...env,
    [CRAWCLAW_CLI_ENV_VAR]: CRAWCLAW_CLI_ENV_VALUE,
  };
}

export function ensureCrawClawExecMarkerOnProcess(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  env[CRAWCLAW_CLI_ENV_VAR] = CRAWCLAW_CLI_ENV_VALUE;
  return env;
}
