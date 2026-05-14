function normalizeProcArg(arg: string): string {
  return arg.replaceAll("\\", "/").toLowerCase();
}

export function parseProcCmdline(raw: string): string[] {
  return raw
    .split("\0")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Parse a Windows command line string into argv-style tokens,
 * handling double-quoted paths (e.g. `"C:\Program Files\node.exe" gateway run`).
 */
export function parseWindowsCmdline(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  for (const char of raw) {
    if (char === '"') {
      inQuote = !inQuote;
    } else if (char === " " && !inQuote) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) {
    args.push(current);
  }
  return args;
}

export function isGatewayArgv(args: string[]): boolean {
  const normalized = args.map(normalizeProcArg);
  const exe = (normalized[0] ?? "").replace(/\.(bat|cmd|exe)$/i, "");
  if (exe.endsWith("/crawclaw-gateway") || exe === "crawclaw-gateway") {
    return true;
  }

  return false;
}
