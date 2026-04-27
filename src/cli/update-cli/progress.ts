import { spinner } from "@clack/prompts";
import { formatDurationPrecise } from "../../infra/format-time/format-duration.ts";
import type {
  UpdateRunResult,
  UpdateStepInfo,
  UpdateStepProgress,
  UpdateStepResult,
} from "../../infra/update-runner.js";
import { defaultRuntime } from "../../runtime.js";
import { theme } from "../../terminal/theme.js";
import { createCliTranslator, getActiveCliLocale } from "../i18n/index.js";
import type { UpdateCommandOptions } from "./shared.js";

const STEP_LABEL_KEYS: Record<string, string> = {
  "clean check": "update.progress.step.cleanCheck",
  "upstream check": "update.progress.step.upstreamCheck",
  "git fetch": "update.progress.step.gitFetch",
  "git rebase": "update.progress.step.gitRebase",
  "git rev-parse @{upstream}": "update.progress.step.resolveUpstreamCommit",
  "git rev-list": "update.progress.step.enumerateCandidateCommits",
  "git clone": "update.progress.step.gitClone",
  "preflight worktree": "update.progress.step.preflightWorktree",
  "preflight cleanup": "update.progress.step.preflightCleanup",
  "deps install": "update.progress.step.depsInstall",
  build: "update.progress.step.build",
  "crawclaw doctor entry": "update.progress.step.doctorEntrypoint",
  "crawclaw doctor": "update.progress.step.doctor",
  "git rev-parse HEAD (after)": "update.progress.step.verifyUpdate",
  "global update": "update.progress.step.globalUpdate",
  "global update (omit optional)": "update.progress.step.globalUpdateOmitOptional",
  "global install": "update.progress.step.globalInstall",
};

function getStepLabel(step: Pick<UpdateStepInfo, "name"> | Pick<UpdateStepResult, "name">): string {
  const t = createCliTranslator(getActiveCliLocale());
  const key = STEP_LABEL_KEYS[step.name];
  return key ? t(key) : step.name;
}

export function inferUpdateFailureHints(result: UpdateRunResult): string[] {
  const t = createCliTranslator(getActiveCliLocale());
  if (result.status !== "error" || result.mode !== "npm") {
    return [];
  }
  const failedStep = [...result.steps].toReversed().find((step) => step.exitCode !== 0);
  if (!failedStep) {
    return [];
  }

  const stderr = (failedStep.stderrTail ?? "").toLowerCase();
  const hints: string[] = [];

  if (failedStep.name.startsWith("global update") && stderr.includes("eacces")) {
    hints.push(t("update.progress.hint.permissionFailure"));
    hints.push(t("update.progress.hint.permissionExample"));
  }

  if (
    failedStep.name.startsWith("global update") &&
    (stderr.includes("node-gyp") || stderr.includes("prebuild"))
  ) {
    hints.push(t("update.progress.hint.nativeOptionalFailure"));
    hints.push(t("update.progress.hint.nativeOptionalRetry"));
  }

  return hints;
}

export type ProgressController = {
  progress: UpdateStepProgress;
  stop: () => void;
};

export function createUpdateProgress(enabled: boolean): ProgressController {
  if (!enabled) {
    return {
      progress: {},
      stop: () => {},
    };
  }

  let currentSpinner: ReturnType<typeof spinner> | null = null;

  const progress: UpdateStepProgress = {
    onStepStart: (step) => {
      currentSpinner = spinner();
      currentSpinner.start(theme.accent(getStepLabel(step)));
    },
    onStepComplete: (step) => {
      if (!currentSpinner) {
        return;
      }

      const label = getStepLabel(step);
      const duration = theme.muted(`(${formatDurationPrecise(step.durationMs)})`);
      const icon = step.exitCode === 0 ? theme.success("\u2713") : theme.error("\u2717");

      currentSpinner.stop(`${icon} ${label} ${duration}`);
      currentSpinner = null;

      if (step.exitCode !== 0 && step.stderrTail) {
        const lines = step.stderrTail.split("\n").slice(-10);
        for (const line of lines) {
          if (line.trim()) {
            defaultRuntime.log(`    ${theme.error(line)}`);
          }
        }
      }
    },
  };

  return {
    progress,
    stop: () => {
      if (currentSpinner) {
        currentSpinner.stop();
        currentSpinner = null;
      }
    },
  };
}

function formatStepStatus(exitCode: number | null): string {
  if (exitCode === 0) {
    return theme.success("\u2713");
  }
  if (exitCode === null) {
    return theme.warn("?");
  }
  return theme.error("\u2717");
}

type PrintResultOptions = UpdateCommandOptions & {
  hideSteps?: boolean;
};

export function printResult(result: UpdateRunResult, opts: PrintResultOptions): void {
  const t = createCliTranslator(getActiveCliLocale());
  if (opts.json) {
    defaultRuntime.writeJson(result);
    return;
  }

  const statusColor =
    result.status === "ok" ? theme.success : result.status === "skipped" ? theme.warn : theme.error;

  defaultRuntime.log("");
  defaultRuntime.log(
    `${theme.heading(t("update.progress.result.title"))} ${statusColor(result.status.toUpperCase())}`,
  );
  if (result.root) {
    defaultRuntime.log(`  ${t("update.progress.result.root")}: ${theme.muted(result.root)}`);
  }
  if (result.reason) {
    defaultRuntime.log(`  ${t("update.progress.result.reason")}: ${theme.muted(result.reason)}`);
  }

  if (result.before?.version || result.before?.sha) {
    const before = result.before.version ?? result.before.sha?.slice(0, 8) ?? "";
    defaultRuntime.log(`  ${t("update.progress.result.before")}: ${theme.muted(before)}`);
  }
  if (result.after?.version || result.after?.sha) {
    const after = result.after.version ?? result.after.sha?.slice(0, 8) ?? "";
    defaultRuntime.log(`  ${t("update.progress.result.after")}: ${theme.muted(after)}`);
  }

  if (!opts.hideSteps && result.steps.length > 0) {
    defaultRuntime.log("");
    defaultRuntime.log(theme.heading(t("update.progress.result.steps")));
    for (const step of result.steps) {
      const status = formatStepStatus(step.exitCode);
      const duration = theme.muted(`(${formatDurationPrecise(step.durationMs)})`);
      defaultRuntime.log(`  ${status} ${getStepLabel(step)} ${duration}`);

      if (step.exitCode !== 0 && step.stderrTail) {
        const lines = step.stderrTail.split("\n").slice(0, 5);
        for (const line of lines) {
          if (line.trim()) {
            defaultRuntime.log(`      ${theme.error(line)}`);
          }
        }
      }
    }
  }

  const hints = inferUpdateFailureHints(result);
  if (hints.length > 0) {
    defaultRuntime.log("");
    defaultRuntime.log(theme.heading(t("update.progress.result.recoveryHints")));
    for (const hint of hints) {
      defaultRuntime.log(`  - ${theme.warn(hint)}`);
    }
  }

  defaultRuntime.log("");
  defaultRuntime.log(
    `${t("update.progress.result.totalTime")}: ${theme.muted(formatDurationPrecise(result.durationMs))}`,
  );
}
