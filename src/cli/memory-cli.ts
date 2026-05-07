import type { Command } from "commander";
import { createCliTranslator } from "./i18n/index.js";
import { formatDocsLink, formatHelpExamples, theme } from "./memory-cli.runtime.js";
import type { MemoryCommandOptions } from "./memory-cli.types.js";
import { getProgramContext } from "./program/program-context.js";

type MemoryCliRuntime = typeof import("./memory-cli.runtime.js");

let memoryCliRuntimePromise: Promise<MemoryCliRuntime> | null = null;

async function loadMemoryCliRuntime(): Promise<MemoryCliRuntime> {
  memoryCliRuntimePromise ??= import("./memory-cli.runtime.js");
  return await memoryCliRuntimePromise;
}

export async function runMemoryStatus(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryStatus(opts);
}

async function runMemoryRefresh(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryRefresh(opts);
}

async function runMemoryLogin(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryLogin(opts);
}

async function runMemorySync(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemorySync(opts);
}

async function runMemoryPromptJournalSummary(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryPromptJournalSummary(opts);
}

async function runMemoryDreamStatus(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryDreamStatus(opts);
}

async function runMemoryDreamRun(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryDreamRun(opts);
}

async function runMemoryDreamHistory(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemoryDreamHistory(opts);
}

async function runMemorySessionSummaryStatus(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemorySessionSummaryStatus(opts);
}

async function runMemorySessionSummaryRefresh(opts: MemoryCommandOptions) {
  const runtime = await loadMemoryCliRuntime();
  await runtime.runMemorySessionSummaryRefresh(opts);
}

export function registerMemoryCli(program: Command) {
  const t = getProgramContext(program)?.t ?? createCliTranslator("en");
  const memory = program
    .command("memory")
    .description(t("command.memory.description"))
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading(t("cli.help.examplesHeading"))}\n${formatHelpExamples([
          ["crawclaw memory status", t("command.memory.example.status")],
          ["crawclaw memory refresh", t("command.memory.example.refresh")],
          ["crawclaw memory login", t("command.memory.example.login")],
          ["crawclaw memory sync", t("command.memory.example.sync")],
          [
            "crawclaw memory prompt-journal-summary --json",
            t("command.memory.example.promptJournalSummary"),
          ],
          ["crawclaw memory dream status --json", t("command.memory.example.dreamStatus")],
          ["crawclaw memory dream run --agent main --force", t("command.memory.example.dreamRun")],
          [
            "crawclaw memory dream run --scope-key main --dry-run --session-limit 6",
            t("command.memory.example.dreamDryRun"),
          ],
          [
            "crawclaw memory session-summary status --agent main --session-id sess-1 --json",
            t("command.memory.example.sessionSummaryStatus"),
          ],
          [
            "crawclaw memory session-summary refresh --agent main --session-id sess-1 --session-key agent:main:sess-1 --force",
            t("command.memory.example.sessionSummaryRefresh"),
          ],
          ["crawclaw memory status --json", t("command.memory.example.json")],
        ])}\n\n${theme.muted(t("cli.help.docsLabel"))} ${formatDocsLink("/cli/memory", "docs.crawclaw.ai/cli/memory")}\n`,
    );

  memory
    .command("status")
    .description(t("command.memory.status.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryStatus(opts);
    });

  memory
    .command("refresh")
    .description(t("command.memory.refresh.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryRefresh(opts);
    });

  memory
    .command("login")
    .description(t("command.memory.login.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryLogin(opts);
    });

  memory
    .command("sync")
    .description(t("command.memory.sync.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemorySync(opts);
    });

  memory
    .command("prompt-journal-summary")
    .description(t("command.memory.promptJournalSummary.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--file <path>", t("command.memory.promptJournalSummary.option.file"))
    .option("--dir <path>", t("command.memory.promptJournalSummary.option.dir"))
    .option("--date <YYYY-MM-DD>", t("command.memory.promptJournalSummary.option.date"))
    .option("--days <n>", t("command.memory.promptJournalSummary.option.days"), "1")
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryPromptJournalSummary(opts);
    });

  const dream = memory.command("dream").description(t("command.memory.dream.description"));

  dream
    .command("status")
    .description(t("command.memory.dream.status.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--agent <id>", t("command.memory.option.agent"))
    .option("--scope-key <key>", t("command.memory.option.scopeKey"))
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryDreamStatus(opts);
    });

  dream
    .command("run")
    .description(t("command.memory.dream.run.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--agent <id>", t("command.memory.option.agent"))
    .option("--scope-key <key>", t("command.memory.option.scopeKey"))
    .option("--force", t("command.memory.dream.run.option.force"), false)
    .option("--dry-run", t("command.memory.dream.run.option.dryRun"), false)
    .option("--session-limit <n>", t("command.memory.dream.run.option.sessionLimit"), "12")
    .option("--signal-limit <n>", t("command.memory.dream.run.option.signalLimit"), "12")
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryDreamRun(opts);
    });

  dream
    .command("history")
    .description(t("command.memory.dream.history.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--agent <id>", t("command.memory.option.agent"))
    .option("--scope-key <key>", t("command.memory.option.scopeKey"))
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryDreamHistory(opts);
    });

  const sessionSummary = memory
    .command("session-summary")
    .description(t("command.memory.sessionSummary.description"));

  sessionSummary
    .command("status")
    .description(t("command.memory.sessionSummary.status.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--agent <id>", t("command.memory.sessionSummary.option.agent"), "main")
    .requiredOption("--session-id <id>", t("command.memory.sessionSummary.option.sessionId"))
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemorySessionSummaryStatus(opts);
    });

  sessionSummary
    .command("refresh")
    .description(t("command.memory.sessionSummary.refresh.description"))
    .option("--json", t("command.memory.option.json"))
    .option("--agent <id>", t("command.memory.sessionSummary.option.agent"), "main")
    .requiredOption("--session-id <id>", t("command.memory.sessionSummary.option.sessionId"))
    .requiredOption("--session-key <key>", t("command.memory.sessionSummary.option.sessionKey"))
    .option("--force", t("command.memory.sessionSummary.refresh.option.force"), false)
    .option("--verbose", t("command.memory.option.verbose"), false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemorySessionSummaryRefresh(opts);
    });
}
