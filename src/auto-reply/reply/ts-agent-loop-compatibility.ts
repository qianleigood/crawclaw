export function isTsAgentLoopCompatibilityAllowed(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return env.NODE_ENV === "test" || env.VITEST === "true";
}

export function assertTsAgentLoopCompatibilityAllowed(
  surface: string,
  env?: Readonly<Record<string, string | undefined>>,
): void {
  if (isTsAgentLoopCompatibilityAllowed(env)) {
    return;
  }
  throw new Error(
    `${surface} is a test-only TS agent loop compatibility facade; production agent turns must use Rust agent.runTurn.`,
  );
}
