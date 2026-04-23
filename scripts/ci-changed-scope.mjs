import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

/** @typedef {{ runNode: boolean; runWindows: boolean; runSkillsPython: boolean; runChangedSmoke: boolean }} ChangedScope */

const DOCS_PATH_RE = /^(docs\/|.*\.mdx?$)/;
const SKILLS_PYTHON_SCOPE_RE = /^(skills\/|pyproject\.toml$)/;
const CI_WORKFLOW_SCOPE_RE = /^\.github\/workflows\/ci\.yml$/;
const INSTALL_SMOKE_WORKFLOW_SCOPE_RE = /^\.github\/workflows\/install-smoke\.yml$/;
const WINDOWS_NATIVE_SMOKE_WORKFLOW_SCOPE_RE = /^\.github\/workflows\/windows-native-smoke\.yml$/;
const NODE_SCOPE_RE =
  /^(src\/|test\/|extensions\/|packages\/|scripts\/|ui\/|\.github\/|crawclaw\.mjs$|crawclaw\.mjs$|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|tsconfig.*\.json$|vitest.*\.ts$|tsdown\.config\.ts$|\.oxlintrc\.json$|\.oxfmtrc\.jsonc$)/;
const WINDOWS_SCOPE_RE =
  /^(src\/|test\/|extensions\/|packages\/|scripts\/|ui\/|crawclaw\.mjs$|crawclaw\.mjs$|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|tsconfig.*\.json$|vitest.*\.ts$|tsdown\.config\.ts$|\.github\/workflows\/ci\.yml$|\.github\/workflows\/windows-native-smoke\.yml$|\.github\/actions\/setup-node-env\/action\.yml$|\.github\/actions\/setup-pnpm-store-cache\/action\.yml$)/;
const CHANGED_SMOKE_SCOPE_RE =
  /^(Dockerfile$|\.npmrc$|package\.json$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|scripts\/install\.(sh|ps1)$|scripts\/postinstall-bundled-plugins\.mjs$|scripts\/install-plugin-runtimes\.mjs$|scripts\/ci\/windows-packed-install-smoke\.mjs$|scripts\/ci-changed-scope\.mjs$|scripts\/ci-write-manifest-outputs\.mjs$|scripts\/test-planner\/planner\.mjs$|scripts\/test-install-sh-docker\.sh$|scripts\/docker\/|extensions\/[^/]+\/package\.json$|\.github\/workflows\/install-smoke\.yml$|\.github\/actions\/setup-node-env\/action\.yml$)/;

/**
 * @param {string[]} changedPaths
 * @returns {ChangedScope}
 */
export function detectChangedScope(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0) {
    return {
      runNode: true,
      runWindows: true,
      runSkillsPython: true,
      runChangedSmoke: true,
    };
  }

  let runNode = false;
  let runWindows = false;
  let runSkillsPython = false;
  let runChangedSmoke = false;
  let hasNonDocs = false;

  for (const rawPath of changedPaths) {
    const path = rawPath.trim();
    if (!path) {
      continue;
    }

    if (DOCS_PATH_RE.test(path)) {
      continue;
    }

    hasNonDocs = true;

    if (SKILLS_PYTHON_SCOPE_RE.test(path)) {
      runSkillsPython = true;
    }

    if (CI_WORKFLOW_SCOPE_RE.test(path)) {
      runSkillsPython = true;
    }

    if (INSTALL_SMOKE_WORKFLOW_SCOPE_RE.test(path)) {
      runChangedSmoke = true;
    }

    if (WINDOWS_NATIVE_SMOKE_WORKFLOW_SCOPE_RE.test(path)) {
      runWindows = true;
    }

    if (NODE_SCOPE_RE.test(path)) {
      runNode = true;
    }

    if (WINDOWS_SCOPE_RE.test(path)) {
      runWindows = true;
    }

    if (CHANGED_SMOKE_SCOPE_RE.test(path)) {
      runChangedSmoke = true;
    }
  }

  if (!runNode && hasNonDocs) {
    runNode = true;
  }

  return { runNode, runWindows, runSkillsPython, runChangedSmoke };
}

/**
 * @param {string} base
 * @param {string} [head]
 * @returns {string[]}
 */
export function listChangedPaths(base, head = "HEAD") {
  if (!base) {
    return [];
  }
  const output = execFileSync("git", ["diff", "--name-only", base, head], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * @param {ChangedScope} scope
 * @param {string} [outputPath]
 */
export function writeGitHubOutput(scope, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is required");
  }
  appendFileSync(outputPath, `run_node=${scope.runNode}\n`, "utf8");
  appendFileSync(outputPath, `run_windows=${scope.runWindows}\n`, "utf8");
  appendFileSync(outputPath, `run_skills_python=${scope.runSkillsPython}\n`, "utf8");
  appendFileSync(outputPath, `run_changed_smoke=${scope.runChangedSmoke}\n`, "utf8");
}

function isDirectRun() {
  const direct = process.argv[1];
  return Boolean(direct && import.meta.url.endsWith(direct));
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const args = { base: "", head: "HEAD" };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--base") {
      args.base = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (argv[i] === "--head") {
      args.head = argv[i + 1] ?? "HEAD";
      i += 1;
    }
  }
  return args;
}

if (isDirectRun()) {
  const args = parseArgs(process.argv.slice(2));
  try {
    const changedPaths = listChangedPaths(args.base, args.head);
    if (changedPaths.length === 0) {
      writeGitHubOutput({
        runNode: true,
        runWindows: true,
        runSkillsPython: true,
        runChangedSmoke: true,
      });
      process.exit(0);
    }
    writeGitHubOutput(detectChangedScope(changedPaths));
  } catch {
    writeGitHubOutput({
      runNode: true,
      runWindows: true,
      runSkillsPython: true,
      runChangedSmoke: true,
    });
  }
}
