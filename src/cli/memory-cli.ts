import type { Command } from "commander";
import { formatDocsLink, formatHelpExamples, theme } from "./memory-cli.runtime.js";
import type { MemoryCommandOptions } from "./memory-cli.types.js";

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
  const memory = program
    .command("memory")
    .description("Inspect and manage NotebookLM knowledge access")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Examples:")}\n${formatHelpExamples([
          ["crawclaw memory status", "Show NotebookLM provider status."],
          [
            "crawclaw memory refresh",
            "Refresh NotebookLM auth from the configured cookie fallback.",
          ],
          ["crawclaw memory login", "Open NotebookLM login flow and rebuild the local profile."],
          [
            "crawclaw memory prompt-journal-summary --json",
            "Summarize nightly memory prompt journal data.",
          ],
          ["crawclaw memory dream status --json", "Show auto-dream state and recent dream runs."],
          [
            "crawclaw memory dream run --agent main --channel telegram --user alice --force",
            "Trigger one durable-memory dream run for a scope.",
          ],
          [
            "crawclaw memory dream run --agent main --channel telegram --user alice --dry-run --session-limit 6",
            "Preview one dream window without writing durable memory.",
          ],
          [
            "crawclaw memory session-summary status --agent main --session-id sess-1 --json",
            "Show one session summary file and runtime state.",
          ],
          [
            "crawclaw memory session-summary refresh --agent main --session-id sess-1 --session-key agent:main:sess-1 --force",
            "Force one background summary refresh for a session.",
          ],
          ["crawclaw memory status --json", "Output machine-readable JSON (good for scripts)."],
        ])}\n\n${theme.muted("Docs:")} ${formatDocsLink("/cli/memory", "docs.crawclaw.ai/cli/memory")}\n`,
    );

  memory
    .command("status")
    .description("Show NotebookLM knowledge provider status")
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryStatus(opts);
    });

  memory
    .command("refresh")
    .description("Refresh NotebookLM knowledge auth from the configured cookie fallback")
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryRefresh(opts);
    });

  memory
    .command("login")
    .description("Run NotebookLM login and rebuild the local profile")
    .option("--json", "Print JSON")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryLogin(opts);
    });

  memory
    .command("prompt-journal-summary")
    .description("Summarize nightly memory prompt journal data")
    .option("--json", "Print JSON")
    .option("--file <path>", "Read a specific journal JSONL file")
    .option("--dir <path>", "Read journal files from a specific directory")
    .option("--date <YYYY-MM-DD>", "Summarize a specific date bucket")
    .option("--days <n>", "Summarize the most recent N daily files", "1")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryPromptJournalSummary(opts);
    });

  const dream = memory.command("dream").description("Inspect and run durable-memory dream passes");

  dream
    .command("status")
    .description("Show auto-dream state and recent dream runs")
    .option("--json", "Print JSON")
    .option("--agent <id>", "Agent id for scope resolution")
    .option("--channel <id>", "Channel id for scope resolution")
    .option("--user <id>", "User id for scope resolution")
    .option("--scope-key <key>", "Explicit durable scope key")
    .option("--limit <n>", "Maximum recent runs to display", "10")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryDreamStatus(opts);
    });

  dream
    .command("run")
    .description("Trigger an auto-dream pass now")
    .option("--json", "Print JSON")
    .option("--agent <id>", "Agent id for scope resolution")
    .option("--channel <id>", "Channel id for scope resolution")
    .option("--user <id>", "User id for scope resolution")
    .option("--scope-key <key>", "Explicit durable scope key")
    .option("--force", "Bypass min-hours and min-sessions gates", false)
    .option("--dry-run", "Preview dream inputs without writing durable memory", false)
    .option("--session-limit <n>", "Cap how many recent sessions feed one manual run", "12")
    .option("--signal-limit <n>", "Cap how many structured signals feed one manual run", "12")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryDreamRun(opts);
    });

  dream
    .command("history")
    .description("Show recent auto-dream runs")
    .option("--json", "Print JSON")
    .option("--agent <id>", "Agent id for scope resolution")
    .option("--channel <id>", "Channel id for scope resolution")
    .option("--user <id>", "User id for scope resolution")
    .option("--scope-key <key>", "Explicit durable scope key")
    .option("--limit <n>", "Maximum recent runs to display", "20")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemoryDreamHistory(opts);
    });

  const sessionSummary = memory
    .command("session-summary")
    .description("Inspect and refresh Claude-style per-session summary files");

  sessionSummary
    .command("status")
    .description("Show one session summary file and runtime state")
    .option("--json", "Print JSON")
    .option("--agent <id>", "Agent id for the session summary", "main")
    .requiredOption("--session-id <id>", "Session id")
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemorySessionSummaryStatus(opts);
    });

  sessionSummary
    .command("refresh")
    .description("Force one session summary refresh for a session")
    .option("--json", "Print JSON")
    .option("--agent <id>", "Agent id for the session summary", "main")
    .requiredOption("--session-id <id>", "Session id")
    .requiredOption("--session-key <key>", "Session key")
    .option("--force", "Bypass the summary gate checks", false)
    .option("--verbose", "Verbose logging", false)
    .action(async (opts: MemoryCommandOptions) => {
      await runMemorySessionSummaryRefresh(opts);
    });
}
