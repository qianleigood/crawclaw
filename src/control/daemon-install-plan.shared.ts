export function resolveGatewayDevMode(argv: string[] = process.argv): boolean {
  const entry = argv[1];
  const normalizedEntry = entry?.replaceAll("\\", "/");
  return (normalizedEntry?.includes("/src/") ?? false) && normalizedEntry.endsWith(".ts");
}

export function resolveDaemonInstallRuntimeInputs(params: { devMode?: boolean }): {
  devMode: boolean;
} {
  const devMode = params.devMode ?? resolveGatewayDevMode();
  return { devMode };
}
