export function buildNodeShellCommand(command: string, platform?: string | null) {
  const normalized = (platform ?? "").trim().toLowerCase();
  if (normalized.startsWith("win")) {
    return ["cmd.exe", "/d", "/s", "/c", command];
  }
  return ["/bin/sh", "-lc", command];
}
