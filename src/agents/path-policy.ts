import path from "node:path";
import { normalizeWindowsPathForComparison } from "../infra/path-guards.js";

function expandPath(filePath: string): string {
  if (filePath === "~") {
    return process.env.HOME ?? filePath;
  }
  if (filePath.startsWith("~/")) {
    const home = process.env.HOME;
    return home ? path.join(home, filePath.slice(2)) : filePath;
  }
  return filePath;
}

export function resolvePathFromInput(filePath: string, cwd: string): string {
  const expanded = expandPath(filePath);
  return path.normalize(path.isAbsolute(expanded) ? expanded : path.resolve(cwd, expanded));
}

type RelativePathOptions = {
  allowRoot?: boolean;
  cwd?: string;
  boundaryLabel?: string;
  includeRootInError?: boolean;
};

function throwPathEscapesBoundary(params: {
  options?: RelativePathOptions;
  rootResolved: string;
  candidate: string;
}): never {
  const boundary = params.options?.boundaryLabel ?? "workspace root";
  const suffix = params.options?.includeRootInError ? ` (${params.rootResolved})` : "";
  throw new Error(`Path escapes ${boundary}${suffix}: ${params.candidate}`);
}

function validateRelativePathWithinBoundary(params: {
  relativePath: string;
  isAbsolutePath: (path: string) => boolean;
  options?: RelativePathOptions;
  rootResolved: string;
  candidate: string;
}): string {
  if (params.relativePath === "" || params.relativePath === ".") {
    if (params.options?.allowRoot) {
      return "";
    }
    throwPathEscapesBoundary({
      options: params.options,
      rootResolved: params.rootResolved,
      candidate: params.candidate,
    });
  }
  if (params.relativePath.startsWith("..") || params.isAbsolutePath(params.relativePath)) {
    throwPathEscapesBoundary({
      options: params.options,
      rootResolved: params.rootResolved,
      candidate: params.candidate,
    });
  }
  return params.relativePath;
}

function toRelativePathUnderRoot(params: {
  root: string;
  candidate: string;
  options?: RelativePathOptions;
}): string {
  const resolvedInput = resolvePathFromInput(params.candidate, params.options?.cwd ?? params.root);

  if (process.platform === "win32") {
    const rootResolved = path.win32.resolve(params.root);
    const resolvedCandidate = path.win32.resolve(resolvedInput);
    const rootForCompare = normalizeWindowsPathForComparison(rootResolved);
    const targetForCompare = normalizeWindowsPathForComparison(resolvedCandidate);
    const relative = path.win32.relative(rootForCompare, targetForCompare);
    return validateRelativePathWithinBoundary({
      relativePath: relative,
      isAbsolutePath: path.win32.isAbsolute,
      options: params.options,
      rootResolved,
      candidate: params.candidate,
    });
  }

  const rootResolved = path.resolve(params.root);
  const resolvedCandidate = path.resolve(resolvedInput);
  const relative = path.relative(rootResolved, resolvedCandidate);
  return validateRelativePathWithinBoundary({
    relativePath: relative,
    isAbsolutePath: path.isAbsolute,
    options: params.options,
    rootResolved,
    candidate: params.candidate,
  });
}

function toRelativeBoundaryPath(params: {
  root: string;
  candidate: string;
  options?: Pick<RelativePathOptions, "allowRoot" | "cwd">;
  boundaryLabel: string;
  includeRootInError?: boolean;
}): string {
  return toRelativePathUnderRoot({
    root: params.root,
    candidate: params.candidate,
    options: {
      allowRoot: params.options?.allowRoot,
      cwd: params.options?.cwd,
      boundaryLabel: params.boundaryLabel,
      includeRootInError: params.includeRootInError,
    },
  });
}

export function toRelativeWorkspacePath(
  root: string,
  candidate: string,
  options?: Pick<RelativePathOptions, "allowRoot" | "cwd">,
): string {
  return toRelativeBoundaryPath({
    root,
    candidate,
    options,
    boundaryLabel: "workspace root",
  });
}
