import fs from "node:fs/promises";
import path from "node:path";

type GatewayProgramArgs = {
  programArguments: string[];
  workingDirectory?: string;
};

function nativeGatewayBinaryName(): string {
  return process.platform === "win32" ? "crawclaw-gateway.exe" : "crawclaw-gateway";
}

async function resolveGatewayBinaryPathForService(params: { dev?: boolean }): Promise<string> {
  const argv1 = process.argv[1];
  if (!argv1) {
    throw new Error("Unable to resolve gateway binary path");
  }

  const normalized = path.resolve(argv1);
  const resolvedPath = await resolveRealpathSafe(normalized);
  const looksLikeNativeGateway = isNativeGatewayBinaryPath(resolvedPath);
  if (looksLikeNativeGateway) {
    await fs.access(resolvedPath);
    const normalizedLooksLikeGateway = isNativeGatewayBinaryPath(normalized);
    if (normalizedLooksLikeGateway && normalized !== resolvedPath) {
      try {
        await fs.access(normalized);
        return normalized;
      } catch {
        // Fall through to return resolvedPath
      }
    }
    return resolvedPath;
  }

  const candidates = params.dev
    ? buildDevGatewayCandidates(resolvedPath, normalized)
    : buildGatewayCandidates(resolvedPath, normalized);

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // keep going
    }
  }

  throw new Error(
    `Cannot find native CrawClaw gateway binary at ${candidates.join(" or ")}. Run "pnpm build" first.`,
  );
}

async function resolveRealpathSafe(inputPath: string): Promise<string> {
  try {
    return await fs.realpath(inputPath);
  } catch {
    return inputPath;
  }
}

function isNativeGatewayBinaryPath(inputPath: string): boolean {
  return path.basename(inputPath).toLowerCase() === nativeGatewayBinaryName().toLowerCase();
}

function buildGatewayCandidates(...inputs: string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const inputPath of inputs) {
    if (!inputPath) {
      continue;
    }
    const baseDir = path.dirname(inputPath);
    appendNativeGatewayCandidates(candidates, seen, path.resolve(baseDir, ".."));
    appendNativeGatewayCandidates(candidates, seen, baseDir);
    appendNodeModulesBinCandidates(candidates, seen, inputPath);
  }

  return candidates;
}

function buildDevGatewayCandidates(...inputs: string[]): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const inputPath of inputs) {
    const repoRoot = resolveRepoRootFromPath(inputPath);
    appendReleaseTargetGatewayCandidate(candidates, seen, repoRoot);
  }
  return candidates;
}

function appendNativeGatewayCandidates(
  candidates: string[],
  seen: Set<string>,
  baseDir: string,
): void {
  appendCandidate(
    candidates,
    seen,
    path.resolve(baseDir, "dist", "native", nativeGatewayBinaryName()),
  );
}

function appendReleaseTargetGatewayCandidate(
  candidates: string[],
  seen: Set<string>,
  repoRoot: string,
): void {
  appendCandidate(
    candidates,
    seen,
    path.resolve(repoRoot, "target", "release", nativeGatewayBinaryName()),
  );
}

function appendCandidate(candidates: string[], seen: Set<string>, candidate: string): void {
  if (seen.has(candidate)) {
    return;
  }
  seen.add(candidate);
  candidates.push(candidate);
}

function appendNodeModulesBinCandidates(
  candidates: string[],
  seen: Set<string>,
  inputPath: string,
): void {
  const parts = inputPath.split(path.sep);
  const binIndex = parts.lastIndexOf(".bin");
  if (binIndex <= 0) {
    return;
  }
  if (parts[binIndex - 1] !== "node_modules") {
    return;
  }
  const binName = path.basename(inputPath);
  const nodeModulesDir = parts.slice(0, binIndex).join(path.sep);
  const packageRoot = path.join(nodeModulesDir, binName);
  appendNativeGatewayCandidates(candidates, seen, packageRoot);
}

function resolveRepoRootFromPath(inputPath: string): string {
  const normalized = path.resolve(inputPath);
  const parts = normalized.split(path.sep);
  for (const marker of ["src", "scripts"]) {
    const markerIndex = parts.lastIndexOf(marker);
    if (markerIndex > 0) {
      return parts.slice(0, markerIndex).join(path.sep);
    }
  }
  return path.dirname(normalized);
}

async function resolveCliProgramArguments(params: {
  args: string[];
  dev?: boolean;
}): Promise<GatewayProgramArgs> {
  const gatewayBinaryPath = await resolveGatewayBinaryPathForService(params);
  const workingDirectory = params.dev
    ? resolveRepoRootFromPath(process.argv[1] ?? gatewayBinaryPath)
    : undefined;
  return {
    programArguments: [gatewayBinaryPath, ...params.args],
    workingDirectory,
  };
}

export async function resolveGatewayProgramArguments(params: {
  port: number;
  dev?: boolean;
}): Promise<GatewayProgramArgs> {
  const gatewayArgs = ["--port", String(params.port)];
  return resolveCliProgramArguments({
    args: gatewayArgs,
    dev: params.dev,
  });
}
