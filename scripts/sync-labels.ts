import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type RepoLabel = {
  name: string;
  color?: string;
  description?: string;
};

const COLOR_BY_PREFIX = new Map<string, string>([
  ["bug", "d73a4a"],
  ["channel", "1d76db"],
  ["app", "6f42c1"],
  ["extensions", "0e8a16"],
  ["docs", "0075ca"],
  ["cli", "f9d0c4"],
  ["gateway", "d4c5f9"],
  ["r", "B60205"],
  ["size", "fbca04"],
]);

const EXTRA_LABEL_METADATA = new Map<
  string,
  {
    color: string;
    description?: string;
  }
>([
  [
    "beta-blocker",
    {
      color: "D93F0B",
      description: "Plugin beta-release blocker pending stable cutoff triage",
    },
  ],
  ["bad-barnacle", { color: "7057ff", description: "Exempts a PR from dirty-branch auto-close" }],
  ["bug", { color: "d73a4a", description: "Something is not working" }],
  ["bug:behavior", { color: "D73A4A", description: "Incorrect behavior without a crash" }],
  ["bug:crash", { color: "B60205", description: "Process/app exits unexpectedly or hangs" }],
  [
    "dirty",
    { color: "5319e7", description: "PR appears to include unrelated or unexpected changes" },
  ],
  ["documentation", { color: "0075ca", description: "Improvements or additions to documentation" }],
  ["duplicate", { color: "cfd3d7", description: "This issue or pull request already exists" }],
  ["enhancement", { color: "a2eeef", description: "New feature or request" }],
  ["invalid", { color: "e4e669", description: "This does not seem right" }],
  ["maintainer", { color: "0e8a16", description: "Opened by a maintainer or repo admin" }],
  ["no-stale", { color: "0052cc", description: "Exempt from stale automation" }],
  ["pinned", { color: "0052cc", description: "Pinned issue or pull request" }],
  ["question", { color: "d876e3", description: "Further information is requested" }],
  ["r: moltbook", { color: "B60205", description: "Auto-response for Moltbook-related issues" }],
  [
    "r: no-ci-pr",
    { color: "B60205", description: "Auto-response for PRs that only fix main CI failures" },
  ],
  ["r: skill", { color: "B60205", description: "Auto-response for core skill submissions" }],
  ["r: spam", { color: "B60205", description: "Spam auto-close and lock trigger" }],
  ["r: support", { color: "B60205", description: "Auto-response for support requests" }],
  ["r: testflight", { color: "B60205", description: "Auto-response for TestFlight requests" }],
  [
    "r: third-party-extension",
    { color: "B60205", description: "Auto-response for bundled third-party plugin requests" },
  ],
  [
    "r: too-many-prs",
    { color: "B60205", description: "Author has more than 10 active PRs in this repo" },
  ],
  [
    "r: too-many-prs-override",
    { color: "0e8a16", description: "Exempts a PR from the active PR limit" },
  ],
  ["regression", { color: "D93F0B", description: "Behavior that previously worked and now fails" }],
  ["security", { color: "B60205", description: "Security-sensitive issue or change" }],
  ["stale", { color: "ededed", description: "Inactive issue or pull request pending closure" }],
  ["trigger-response", { color: "fbca04", description: "Manual trigger for auto-response rules" }],
]);

const configPath = resolve(".github/labeler.yml");
const EXTRA_LABELS = [
  "bad-barnacle",
  "bug",
  "bug:behavior",
  "bug:crash",
  "size: XS",
  "size: S",
  "size: M",
  "size: L",
  "size: XL",
  "beta-blocker",
  "dirty",
  "documentation",
  "duplicate",
  "enhancement",
  "invalid",
  "maintainer",
  "no-stale",
  "pinned",
  "question",
  "r: moltbook",
  "r: no-ci-pr",
  "r: skill",
  "r: spam",
  "r: support",
  "r: testflight",
  "r: third-party-extension",
  "r: too-many-prs",
  "r: too-many-prs-override",
  "regression",
  "security",
  "stale",
  "trigger-response",
] as const;
const labelNames = [
  ...new Set([...extractLabelNames(readFileSync(configPath, "utf8")), ...EXTRA_LABELS]),
].toSorted((a, b) => a.localeCompare(b));
const checkOnly = process.argv.includes("--check");

if (!labelNames.length) {
  throw new Error("labeler.yml must declare at least one label.");
}

const repo = resolveRepo();
const existing = fetchExistingLabels(repo);

const missing = labelNames.filter((label) => !existing.has(label));
if (!missing.length) {
  console.log("All labeler labels already exist.");
  process.exit(0);
}

if (checkOnly) {
  console.error("Missing GitHub labels:");
  for (const label of missing) {
    console.error(`- ${label}`);
  }
  process.exit(1);
}

for (const label of missing) {
  const metadata = resolveLabelMetadata(label);
  const args = [
    "api",
    "-X",
    "POST",
    `repos/${repo}/labels`,
    "-f",
    `name=${label}`,
    "-f",
    `color=${metadata.color}`,
  ];
  if (metadata.description) {
    args.push("-f", `description=${metadata.description}`);
  }
  execFileSync("gh", args, { stdio: "inherit" });
  console.log(`Created label: ${label}`);
}

function extractLabelNames(contents: string): string[] {
  const labels: string[] = [];
  for (const line of contents.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) {
      continue;
    }
    if (/^\s/.test(line)) {
      continue;
    }
    const match = line.match(/^(["'])(.+)\1\s*:/) ?? line.match(/^([^:]+):/);
    if (match) {
      const name = (match[2] ?? match[1] ?? "").trim();
      if (name) {
        labels.push(name);
      }
    }
  }
  return labels;
}

function resolveLabelMetadata(label: string): { color: string; description?: string } {
  const extraMetadata = EXTRA_LABEL_METADATA.get(label);
  if (extraMetadata) {
    return extraMetadata;
  }
  const prefix = label.includes(":") ? label.split(":", 1)[0].trim() : label.trim();
  return { color: COLOR_BY_PREFIX.get(prefix) ?? "ededed" };
}

function resolveRepo(): string {
  const remote = execFileSync("git", ["config", "--get", "remote.origin.url"], {
    encoding: "utf8",
  }).trim();

  if (!remote) {
    throw new Error("Unable to determine repository from git remote.");
  }

  if (remote.startsWith("git@github.com:")) {
    return remote.replace("git@github.com:", "").replace(/\.git$/, "");
  }

  if (remote.startsWith("https://github.com/")) {
    return remote.replace("https://github.com/", "").replace(/\.git$/, "");
  }

  throw new Error(`Unsupported GitHub remote: ${remote}`);
}

function fetchExistingLabels(repo: string): Map<string, RepoLabel> {
  const raw = execFileSync(
    "gh",
    ["api", `repos/${repo}/labels?per_page=100`, "--paginate", "--slurp"],
    {
      encoding: "utf8",
    },
  );
  const labels = (JSON.parse(raw) as RepoLabel[][]).flat();
  return new Map(labels.map((label) => [label.name, label]));
}
