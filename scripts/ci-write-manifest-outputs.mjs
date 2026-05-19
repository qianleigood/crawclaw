import { appendFileSync } from "node:fs";

const WORKFLOWS = new Set(["ci"]);

const parseArgs = (argv) => {
  const parsed = { workflow: "ci" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workflow") {
      const nextValue = argv[index + 1] ?? "";
      if (!WORKFLOWS.has(nextValue)) {
        throw new Error(
          `Unsupported --workflow value "${String(nextValue || "<missing>")}". Supported value: ci.`,
        );
      }
      parsed.workflow = nextValue;
      index += 1;
    }
  }
  return parsed;
};

const parseBooleanLike = (value, fallback = false) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "") {
      return false;
    }
  }
  return fallback;
};

const matrix = (include) => ({ include });

const outputPath = process.env.GITHUB_OUTPUT;

if (!outputPath) {
  throw new Error("GITHUB_OUTPUT is required");
}

parseArgs(process.argv.slice(2));

const docsOnly = parseBooleanLike(process.env.CRAWCLAW_CI_DOCS_ONLY, false);
const docsChanged = parseBooleanLike(process.env.CRAWCLAW_CI_DOCS_CHANGED, false);
const runNode = !docsOnly && parseBooleanLike(process.env.CRAWCLAW_CI_RUN_NODE, true);
const runWindows = !docsOnly && parseBooleanLike(process.env.CRAWCLAW_CI_RUN_WINDOWS, true);
const runSkillsPython =
  !docsOnly && parseBooleanLike(process.env.CRAWCLAW_CI_RUN_SKILLS_PYTHON, true);
const isPush = process.env.GITHUB_EVENT_NAME === "push";

const checks = runNode
  ? [
      {
        check_name: "checks-rust-test",
        runtime: "rust",
        task: "test",
        command: "pnpm test",
      },
      ...(isPush
        ? [
            {
              check_name: "checks-node24-build",
              runtime: "node",
              task: "build",
              command: "pnpm build",
            },
          ]
        : []),
    ]
  : [];

const checksWindows = runWindows
  ? [
      {
        check_name: "checks-windows-rust-test",
        runtime: "rust",
        task: "test",
        command: "pnpm test",
      },
      {
        check_name: "checks-windows-node-build",
        runtime: "node",
        task: "build",
        command: "pnpm build",
      },
    ]
  : [];

const requiredCheckNames = [
  ...checks.map((entry) => entry.check_name),
  ...checksWindows.map((entry) => entry.check_name),
  "check",
  "check-additional",
  "build-smoke",
  ...(docsChanged ? ["check-docs"] : []),
  ...(runSkillsPython || isPush ? ["skills-python"] : []),
  ...(runNode ? ["build-artifacts"] : []),
];

const writeOutput = (name, value) => {
  appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
};

writeOutput("docs_only", String(docsOnly));
writeOutput("docs_changed", String(docsChanged));
writeOutput("run_node", String(runNode));
writeOutput("run_skills_python", String(runSkillsPython));
writeOutput("run_windows", String(runWindows));
writeOutput("run_build_artifacts", String(runNode));
writeOutput("run_checks", String(checks.length > 0));
writeOutput("checks_matrix", JSON.stringify(matrix(checks)));
writeOutput("run_check", String(!docsOnly));
writeOutput("run_check_additional", String(!docsOnly));
writeOutput("run_build_smoke", String(runNode));
writeOutput("run_check_docs", String(docsChanged));
writeOutput("run_skills_python_job", String(runSkillsPython || isPush));
writeOutput("run_checks_windows", String(checksWindows.length > 0));
writeOutput("checks_windows_matrix", JSON.stringify(matrix(checksWindows)));
writeOutput("required_check_names", JSON.stringify(requiredCheckNames));
