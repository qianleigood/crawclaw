import { formatCliCommand } from "../cli/command-format.js";
import type { OnboardOptions } from "../commands/onboard-types.js";
import type { CrawClawConfig } from "../config/config.js";
import { formatErrorMessage } from "../infra/errors.js";
import { normalizeNotebookLmConfig } from "../memory/config/notebooklm.js";
import {
  inferNotebookLmLoginCommand,
  runNotebookLmLoginCommand,
} from "../memory/notebooklm/login.js";
import {
  clearNotebookLmProviderStateCache,
  getNotebookLmProviderState,
  type NotebookLmProviderState,
} from "../memory/notebooklm/provider-state.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "./prompts.js";

export async function promptNotebookLmEnablement(params: {
  config: CrawClawConfig;
  prompter: WizardPrompter;
  nonInteractive?: boolean;
}): Promise<CrawClawConfig> {
  if (params.nonInteractive === true) {
    return params.config;
  }

  const notebooklm = normalizeNotebookLmConfig(params.config.memory?.notebooklm ?? {});
  const initialExperienceEnabled = params.config.memory?.experience?.enabled !== false;
  const experienceEnabled = await params.prompter.confirm({
    message: "Enable local experience memory?",
    initialValue: initialExperienceEnabled,
  });

  if (!experienceEnabled) {
    return {
      ...params.config,
      memory: {
        ...params.config.memory,
        experience: {
          ...params.config.memory?.experience,
          enabled: false,
        },
        notebooklm: {
          ...params.config.memory?.notebooklm,
          enabled: false,
        },
      },
    };
  }

  const enabled = await params.prompter.confirm({
    message: "Add NotebookLM as an optional experience provider?",
    initialValue: notebooklm.enabled,
  });

  if (!enabled) {
    return {
      ...params.config,
      memory: {
        ...params.config.memory,
        experience: {
          ...params.config.memory?.experience,
          enabled: true,
        },
        notebooklm: {
          ...params.config.memory?.notebooklm,
          enabled: false,
        },
      },
    };
  }

  const existingCommand = notebooklm.cli.command.trim();
  const command = (
    await params.prompter.text({
      message: "NotebookLM CLI command",
      initialValue: existingCommand || "nlm",
      placeholder: "nlm",
      validate: (value) => (value.trim().length > 0 ? undefined : "Enter a command."),
    })
  ).trim();
  const existingNotebookId =
    (notebooklm.cli.notebookId ?? "").trim() || (notebooklm.write.notebookId ?? "").trim();
  const notebookId = (
    await params.prompter.text({
      message: "NotebookLM notebook ID",
      initialValue: existingNotebookId,
      placeholder: "notebook id",
      validate: (value) => (value.trim().length > 0 ? undefined : "Enter a notebook ID."),
    })
  ).trim();

  return {
    ...params.config,
    memory: {
      ...params.config.memory,
      experience: {
        ...params.config.memory?.experience,
        enabled: true,
      },
      notebooklm: {
        ...params.config.memory?.notebooklm,
        enabled,
        cli: {
          ...notebooklm.cli,
          enabled: true,
          command: command || existingCommand || "nlm",
          notebookId: notebookId || existingNotebookId,
        },
      },
    },
  };
}

function formatNotebookLmStateNote(state: NotebookLmProviderState): string {
  return [
    "NotebookLM experience is enabled but not ready.",
    `Lifecycle: ${state.lifecycle}`,
    `Reason: ${state.reason ?? "unknown"}`,
    `Profile: ${state.profile}`,
    `Notebook: ${state.notebookId ?? "<unset>"}`,
    `Recommended action: ${state.recommendedAction ?? formatCliCommand("crawclaw memory status")}`,
  ].join("\n");
}

export async function maybeHandleNotebookLmOnboarding(params: {
  config: CrawClawConfig;
  opts: OnboardOptions;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
}): Promise<void> {
  const notebooklm = normalizeNotebookLmConfig(params.config.memory?.notebooklm ?? {});
  if (!notebooklm.enabled) {
    return;
  }

  let state: NotebookLmProviderState;
  try {
    state = await getNotebookLmProviderState({ config: notebooklm, mode: "query" });
  } catch (error) {
    await params.prompter.note(
      [
        `NotebookLM status check failed: ${formatErrorMessage(error)}`,
        `Check later: ${formatCliCommand("crawclaw memory status")}`,
      ].join("\n"),
      "NotebookLM",
    );
    return;
  }

  if (state.ready) {
    return;
  }

  const stateNote = formatNotebookLmStateNote(state);
  const loginCommand =
    state.recommendedAction === "crawclaw memory login"
      ? inferNotebookLmLoginCommand(notebooklm)
      : null;

  if (params.opts.nonInteractive === true) {
    await params.prompter.note(stateNote, "NotebookLM");
    return;
  }

  if (state.recommendedAction !== "crawclaw memory login") {
    await params.prompter.note(stateNote, "NotebookLM");
    return;
  }

  if (!loginCommand) {
    await params.prompter.note(
      [
        stateNote,
        "",
        "NotebookLM login command is not configured.",
        `Check config or run: ${formatCliCommand("crawclaw memory status")}`,
      ].join("\n"),
      "NotebookLM",
    );
    return;
  }

  await params.prompter.note(
    [stateNote, "", "You can finish this now during onboarding."].join("\n"),
    "NotebookLM",
  );

  const shouldRunLogin = await params.prompter.confirm({
    message: "Run NotebookLM login now?",
    initialValue: true,
  });
  if (!shouldRunLogin) {
    await params.prompter.note(`Later: ${formatCliCommand("crawclaw memory login")}`, "NotebookLM");
    return;
  }

  const progress = params.prompter.progress("NotebookLM login");
  try {
    progress.update("Opening NotebookLM login…");
    await runNotebookLmLoginCommand(loginCommand.command, loginCommand.args);
    clearNotebookLmProviderStateCache();
    progress.update("Validating NotebookLM profile…");
    state = await getNotebookLmProviderState({ config: notebooklm, mode: "query" });
    progress.stop(state.ready ? "NotebookLM ready." : "NotebookLM still needs attention.");
  } catch (error) {
    progress.stop("NotebookLM login failed.");
    await params.prompter.note(
      [
        `NotebookLM login failed: ${formatErrorMessage(error)}`,
        `Retry later: ${formatCliCommand("crawclaw memory login")}`,
      ].join("\n"),
      "NotebookLM",
    );
    return;
  }

  if (state.ready) {
    await params.prompter.note(
      [
        "NotebookLM experience is now ready.",
        `Profile: ${state.profile}`,
        `Notebook: ${state.notebookId ?? "<unset>"}`,
      ].join("\n"),
      "NotebookLM",
    );
    return;
  }

  await params.prompter.note(formatNotebookLmStateNote(state), "NotebookLM");
}
