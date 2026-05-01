import { createHmac, createHash } from "node:crypto";
import type { ReasoningLevel, ThinkLevel } from "../auto-reply/thinking.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { listDeliverableMessageChannels } from "../utils/message-channel.js";
import type { ResolvedTimeFormat } from "./date-time.js";
import type { EmbeddedContextFile } from "./pi-embedded-helpers.js";
import type { EmbeddedSandboxInfo } from "./pi-embedded-runner/types.js";
import { renderQueryContextSections } from "./query-context/render.js";
import type { QueryContextSection } from "./query-context/types.js";
import { sanitizeForPromptLiteral } from "./sanitize-for-prompt.js";

/**
 * Controls which hardcoded sections are included in the system prompt.
 * - "full": All sections (default, for main agent)
 * - "minimal": Reduced sections (Tooling, Workspace, Runtime) - used for subagents
 * - "none": Just basic identity line, no sections
 */
export type PromptMode = "full" | "minimal" | "none";
type OwnerIdDisplay = "raw" | "hash";

const DURABLE_MEMORY_TOOL_NAMES = new Set([
  "memory_manifest_read",
  "memory_note_read",
  "memory_note_write",
  "memory_note_edit",
  "memory_note_delete",
]);

function buildSkillsSection(params: {
  skillsPrompt?: string;
  readToolName: string;
  discoverSkillsToolName?: string;
}) {
  const trimmed = params.skillsPrompt?.trim();
  const discoverSkillsToolName = params.discoverSkillsToolName?.trim();
  if (!trimmed && !discoverSkillsToolName) {
    return [];
  }
  const lines = [
    "## Skills (mandatory)",
    "Relevant skills are surfaced for the current task.",
    ...(discoverSkillsToolName
      ? [
          `If the surfaced skills do not cover your next action, call \`${discoverSkillsToolName}\` with a specific description of what you are about to do.`,
          "Skip discovery if the surfaced skills already cover the next action.",
        ]
      : []),
    ...(trimmed
      ? [
          "Before replying: scan <available_skills> <description> entries.",
          `- If exactly one skill clearly applies: read its SKILL.md at <location> with \`${params.readToolName}\`, then follow it.`,
          "- If multiple could apply: choose the most specific one, then read/follow it.",
          "- If none clearly apply: do not read any SKILL.md.",
          "Constraints: never read more than one skill up front; only read after selecting.",
        ]
      : []),
    "- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.",
    ...(trimmed ? [trimmed] : []),
    "",
  ];
  return lines;
}

function buildMemorySection(params: {
  isMinimal: boolean;
  availableTools: Set<string>;
  memoryRuntimeActive?: boolean;
}) {
  if (params.isMinimal || params.memoryRuntimeActive) {
    return [];
  }
  const hasDurableMemoryTools = Array.from(DURABLE_MEMORY_TOOL_NAMES).some((toolName) =>
    params.availableTools.has(toolName),
  );
  if (!hasDurableMemoryTools) {
    return [];
  }
  return [
    "## Durable Memory",
    "Use scoped durable memory tools only for stable, future-useful collaboration information.",
    "If the user explicitly asks you to remember, default, forget, remove, or update durable memory, use the scoped durable memory tools when available; do not only acknowledge it verbally.",
    "When writing durable memory, first read the scoped manifest, prefer updating an existing note, and keep MEMORY.md as a short index.",
    "Durable memory notes may only be user, feedback, project, or reference.",
    "Do not save task progress, temporary plans, code structure, file paths, git history, debugging fixes, or activity logs as durable memory.",
    "Current code, docs, git state, runtime state, and user instructions override stale durable memory.",
    "If durable memory tools are unavailable or reject an operation, explain that outcome instead of claiming the memory was changed.",
    "",
  ];
}

function buildUserIdentitySection(ownerLine: string | undefined, isMinimal: boolean) {
  if (!ownerLine || isMinimal) {
    return [];
  }
  return ["## Authorized Senders", ownerLine, ""];
}

function formatOwnerDisplayId(ownerId: string, ownerDisplaySecret?: string) {
  const hasSecret = ownerDisplaySecret?.trim();
  const digest = hasSecret
    ? createHmac("sha256", hasSecret).update(ownerId).digest("hex")
    : createHash("sha256").update(ownerId).digest("hex");
  return digest.slice(0, 12);
}

function buildOwnerIdentityLine(
  ownerNumbers: string[],
  ownerDisplay: OwnerIdDisplay,
  ownerDisplaySecret?: string,
) {
  const normalized = ownerNumbers.map((value) => value.trim()).filter(Boolean);
  if (normalized.length === 0) {
    return undefined;
  }
  const displayOwnerNumbers =
    ownerDisplay === "hash"
      ? normalized.map((ownerId) => formatOwnerDisplayId(ownerId, ownerDisplaySecret))
      : normalized;
  return `Authorized senders: ${displayOwnerNumbers.join(", ")}. These senders are allowlisted; do not assume they are the owner.`;
}

function buildTimeSection(params: { userTimezone?: string }) {
  if (!params.userTimezone) {
    return [];
  }
  return ["## Current Date & Time", `Time zone: ${params.userTimezone}`, ""];
}

function buildReplyTagsSection(isMinimal: boolean) {
  if (isMinimal) {
    return [];
  }
  return [
    "## Reply Tags",
    "To request a native reply/quote on supported surfaces, include one tag in your reply:",
    "- Reply tags must be the very first token in the message (no leading text/newlines): [[reply_to_current]] your reply.",
    "- [[reply_to_current]] replies to the triggering message.",
    "- Prefer [[reply_to_current]]. Use [[reply_to:<id>]] only when an id was explicitly provided (e.g. by the user or a tool).",
    "Whitespace inside the tag is allowed (e.g. [[ reply_to_current ]] / [[ reply_to: 123 ]]).",
    "Tags are stripped before sending; support depends on the current channel config.",
    "",
  ];
}

function buildMessagingSection(params: {
  isMinimal: boolean;
  availableTools: Set<string>;
  messageChannelOptions: string;
  inlineButtonsEnabled: boolean;
  runtimeChannel?: string;
  messageToolHints?: string[];
}) {
  if (params.isMinimal) {
    return [];
  }
  return [
    "## Messaging",
    "- Reply in current session → automatically routes to the source channel (Signal, Telegram, etc.)",
    "- Cross-session messaging → use sessions_send(sessionKey, message)",
    "- Sub-agent orchestration → use subagents(action=list|steer|kill)",
    `- Runtime-generated completion events may ask for a user update. Rewrite those in your normal assistant voice and send the update (do not forward raw internal metadata or default to ${SILENT_REPLY_TOKEN}).`,
    "- Never use exec/curl for provider messaging; CrawClaw handles all routing internally.",
    params.availableTools.has("message")
      ? [
          "",
          "### message tool",
          "- Use `message` for proactive sends + channel actions (polls, reactions, etc.).",
          "- For `action=send`, include `to` and `message`.",
          `- If multiple channels are configured, pass \`channel\` (${params.messageChannelOptions}).`,
          `- If you use \`message\` (\`action=send\`) to deliver your user-visible reply, respond with ONLY: ${SILENT_REPLY_TOKEN} (avoid duplicate replies).`,
          params.inlineButtonsEnabled
            ? "- Inline buttons supported. Use `action=send` with `buttons=[[{text,callback_data,style?}]]`; `style` can be `primary`, `success`, or `danger`."
            : params.runtimeChannel
              ? `- Inline buttons not enabled for ${params.runtimeChannel}. If you need them, ask to set ${params.runtimeChannel}.capabilities.inlineButtons ("dm"|"group"|"all"|"allowlist").`
              : "",
          ...(params.messageToolHints ?? []),
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    "",
  ];
}

function buildVoiceSection(params: { isMinimal: boolean; ttsHint?: string }) {
  if (params.isMinimal) {
    return [];
  }
  const hint = params.ttsHint?.trim();
  if (!hint) {
    return [];
  }
  return ["## Voice (TTS)", hint, ""];
}

function buildDocsSection(params: { docsPath?: string; isMinimal: boolean; readToolName: string }) {
  const docsPath = params.docsPath?.trim();
  if (!docsPath || params.isMinimal) {
    return [];
  }
  return [
    "## Documentation",
    `CrawClaw docs: ${docsPath}`,
    "Mirror: https://docs.crawclaw.ai",
    "Source: https://github.com/qianleigood/crawclaw",
    "Community: https://discord.com/invite/clawd",
    "Find new skills: https://clawhub.ai",
    "For CrawClaw behavior, commands, config, or architecture: consult local docs first.",
    "When diagnosing issues, run `crawclaw status` yourself when possible; only ask the user if you lack access (e.g., sandboxed).",
    "",
  ];
}

function buildExecApprovalPromptGuidance(params: { runtimeChannel?: string }) {
  const runtimeChannel = params.runtimeChannel?.trim().toLowerCase();
  if (
    runtimeChannel === "discord" ||
    runtimeChannel === "slack" ||
    runtimeChannel === "telegram" ||
    runtimeChannel === "webchat"
  ) {
    return "When exec returns approval-pending on Discord, Slack, Telegram, or WebChat, rely on the native approval card/buttons when they appear and do not also send plain chat /approve instructions. Only include the concrete /approve command if the tool result says chat approvals are unavailable or only manual approval is possible.";
  }
  return "When exec returns approval-pending, include the concrete /approve command from tool output as plain chat text for the user, and do not ask for a different or rotated code.";
}

function createPromptSection(
  id: string,
  lines: Array<string | undefined | false>,
  options?: Partial<
    Pick<QueryContextSection, "budget" | "cacheable" | "role" | "sectionType" | "source">
  >,
): QueryContextSection | null {
  const content = lines.filter(Boolean).join("\n").trim();
  if (!content) {
    return null;
  }
  return {
    id,
    role: options?.role ?? "system_prompt",
    content,
    cacheable: options?.cacheable ?? true,
    source: options?.source ?? "system-prompt",
    ...(options?.sectionType ? { sectionType: options.sectionType } : {}),
    ...(options?.budget ? { budget: options.budget } : {}),
  };
}

export function buildAgentSystemPromptSections(params: {
  workspaceDir: string;
  defaultThinkLevel?: ThinkLevel;
  reasoningLevel?: ReasoningLevel;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  ownerDisplay?: OwnerIdDisplay;
  ownerDisplaySecret?: string;
  reasoningTagHint?: boolean;
  toolNames?: string[];
  toolSummaries?: Record<string, string>;
  modelAliasLines?: string[];
  userTimezone?: string;
  userTime?: string;
  userTimeFormat?: ResolvedTimeFormat;
  contextFiles?: EmbeddedContextFile[];
  skillsPrompt?: string;
  heartbeatPrompt?: string;
  docsPath?: string;
  workspaceNotes?: string[];
  ttsHint?: string;
  /** When active, the memory runtime injects detailed memory routing sections. */
  memoryRuntimeActive?: boolean;
  /** Controls which hardcoded sections to include. Defaults to "full". */
  promptMode?: PromptMode;
  /** Whether ACP-specific routing guidance should be included. Defaults to true. */
  acpEnabled?: boolean;
  runtimeInfo?: {
    agentId?: string;
    host?: string;
    os?: string;
    arch?: string;
    node?: string;
    model?: string;
    defaultModel?: string;
    shell?: string;
    channel?: string;
    capabilities?: string[];
    repoRoot?: string;
  };
  messageToolHints?: string[];
  sandboxInfo?: EmbeddedSandboxInfo;
  /** Reaction guidance for the agent (for Telegram minimal/extensive modes). */
  reactionGuidance?: {
    level: "minimal" | "extensive";
    channel: string;
  };
}): QueryContextSection[] {
  const acpEnabled = params.acpEnabled !== false;
  const sandboxedRuntime = params.sandboxInfo?.enabled === true;
  const acpSpawnRuntimeEnabled = acpEnabled && !sandboxedRuntime;
  const coreToolSummaries: Record<string, string> = {
    read: "Read file contents",
    write: "Create or overwrite files",
    edit: "Make precise edits to files",
    apply_patch: "Apply multi-file patches",
    grep: "Search file contents for patterns",
    find: "Find files by glob pattern",
    ls: "List directory contents",
    exec: "Run shell commands (pty available for TTY-required CLIs)",
    process: "Manage background exec sessions",
    web_search: "Search the web",
    web_fetch: "Fetch and extract readable content from a URL",
    // Channel docking: add login tools here when a channel needs interactive linking.
    browser: "Control web browser",
    canvas: "Present/eval/snapshot the Canvas",
    nodes: "List/describe/notify/camera/screen on paired nodes",
    cron: "Manage cron jobs and wake events (use for reminders; when scheduling a reminder, write the systemEvent text as something that will read like a reminder when it fires, and mention that it is a reminder depending on the time gap between setting and firing; include recent context in reminder text if appropriate)",
    message: "Send messages and channel actions",
    gateway: "Restart, apply config, or run updates on the running CrawClaw process",
    agents_list: acpSpawnRuntimeEnabled
      ? 'List CrawClaw agent ids allowed for sessions_spawn when runtime="subagent" (not ACP harness ids)'
      : "List CrawClaw agent ids allowed for sessions_spawn",
    sessions_list: "List other sessions (incl. sub-agents) with filters/last",
    sessions_history: "Fetch history for another session/sub-agent",
    sessions_send: "Send a message to another session/sub-agent",
    sessions_spawn: acpSpawnRuntimeEnabled
      ? 'Spawn an isolated sub-agent or ACP coding session (runtime="acp" requires `agentId` unless `acp.defaultAgent` is configured; ACP harness ids follow acp.allowedAgents, not agents_list)'
      : "Spawn an isolated sub-agent session",
    subagents: "List, steer, or kill sub-agent runs for this requester session",
    session_status:
      "Show a /status-equivalent status card (usage + time + Reasoning/Verbose/Elevated); use for model-use questions (📊 session_status); optional per-session model override",
    image: "Analyze an image with the configured image model",
    discover_skills: "Search available skills for the current task",
  };

  const toolOrder = [
    "read",
    "discover_skills",
    "write",
    "edit",
    "apply_patch",
    "grep",
    "find",
    "ls",
    "exec",
    "process",
    "code_execution",
    "web_search",
    "web_fetch",
    "browser",
    "canvas",
    "nodes",
    "cron",
    "message",
    "gateway",
    "agents_list",
    "sessions_list",
    "sessions_history",
    "sessions_send",
    "subagents",
    "session_status",
    "image",
  ];

  const rawToolNames = (params.toolNames ?? []).map((tool) => tool.trim());
  const canonicalToolNames = rawToolNames.filter(Boolean);
  // Preserve caller casing while deduping tool names by lowercase.
  const canonicalByNormalized = new Map<string, string>();
  for (const name of canonicalToolNames) {
    const normalized = name.toLowerCase();
    if (!canonicalByNormalized.has(normalized)) {
      canonicalByNormalized.set(normalized, name);
    }
  }
  const resolveToolName = (normalized: string) =>
    canonicalByNormalized.get(normalized) ?? normalized;

  const normalizedTools = canonicalToolNames.map((tool) => tool.toLowerCase());
  const availableTools = new Set(normalizedTools);
  const hasSessionsSpawn = availableTools.has("sessions_spawn");
  const acpHarnessSpawnAllowed = hasSessionsSpawn && acpSpawnRuntimeEnabled;
  const externalToolSummaries = new Map<string, string>();
  for (const [key, value] of Object.entries(params.toolSummaries ?? {})) {
    const normalized = key.trim().toLowerCase();
    if (!normalized || !value?.trim()) {
      continue;
    }
    externalToolSummaries.set(normalized, value.trim());
  }
  const extraTools = Array.from(
    new Set(normalizedTools.filter((tool) => !toolOrder.includes(tool))),
  );
  const enabledTools = toolOrder.filter((tool) => availableTools.has(tool));
  const toolLines = enabledTools.map((tool) => {
    const summary = coreToolSummaries[tool] ?? externalToolSummaries.get(tool);
    const name = resolveToolName(tool);
    return summary ? `- ${name}: ${summary}` : `- ${name}`;
  });
  for (const tool of extraTools.toSorted()) {
    const summary = coreToolSummaries[tool] ?? externalToolSummaries.get(tool);
    const name = resolveToolName(tool);
    toolLines.push(summary ? `- ${name}: ${summary}` : `- ${name}`);
  }

  const hasGateway = availableTools.has("gateway");
  const readToolName = resolveToolName("read");
  const discoverSkillsToolName = availableTools.has("discover_skills")
    ? resolveToolName("discover_skills")
    : undefined;
  const execToolName = resolveToolName("exec");
  const processToolName = resolveToolName("process");
  const extraSystemPrompt = params.extraSystemPrompt?.trim();
  const ownerDisplay = params.ownerDisplay === "hash" ? "hash" : "raw";
  const ownerLine = buildOwnerIdentityLine(
    params.ownerNumbers ?? [],
    ownerDisplay,
    params.ownerDisplaySecret,
  );
  const reasoningHint = params.reasoningTagHint
    ? [
        "ALL internal reasoning MUST be inside <think>...</think>.",
        "Do not output any analysis outside <think>.",
        "Format every reply as <think>...</think> then <final>...</final>, with no other text.",
        "Only the final user-visible reply may appear inside <final>.",
        "Only text inside <final> is shown to the user; everything else is discarded and never seen by the user.",
        "Example:",
        "<think>Short internal reasoning.</think>",
        "<final>Hey there! What would you like to do next?</final>",
      ].join(" ")
    : undefined;
  const reasoningLevel = params.reasoningLevel ?? "off";
  const userTimezone = params.userTimezone?.trim();
  const skillsPrompt = params.skillsPrompt?.trim();
  const heartbeatPrompt = params.heartbeatPrompt?.trim();
  const runtimeInfo = params.runtimeInfo;
  const runtimeChannel = runtimeInfo?.channel?.trim().toLowerCase();
  const runtimeCapabilities = (runtimeInfo?.capabilities ?? [])
    .map((cap) => cap.trim())
    .filter(Boolean);
  const runtimeCapabilitiesLower = new Set(runtimeCapabilities.map((cap) => cap.toLowerCase()));
  const inlineButtonsEnabled = runtimeCapabilitiesLower.has("inlinebuttons");
  const messageChannelOptions = listDeliverableMessageChannels().join("|");
  const promptMode = params.promptMode ?? "full";
  const isMinimal = promptMode === "minimal" || promptMode === "none";
  const sandboxContainerWorkspace = params.sandboxInfo?.containerWorkspaceDir?.trim();
  const sanitizedWorkspaceDir = sanitizeForPromptLiteral(params.workspaceDir);
  const sanitizedSandboxContainerWorkspace = sandboxContainerWorkspace
    ? sanitizeForPromptLiteral(sandboxContainerWorkspace)
    : "";
  const displayWorkspaceDir =
    params.sandboxInfo?.enabled && sanitizedSandboxContainerWorkspace
      ? sanitizedSandboxContainerWorkspace
      : sanitizedWorkspaceDir;
  const workspaceGuidance =
    params.sandboxInfo?.enabled && sanitizedSandboxContainerWorkspace
      ? `For read/write/edit/apply_patch, file paths resolve against host workspace: ${sanitizedWorkspaceDir}. For bash/exec commands, use sandbox container paths under ${sanitizedSandboxContainerWorkspace} (or relative paths from that workdir), not host paths. Prefer relative paths so both sandboxed exec and file tools work consistently.`
      : "Treat this directory as the single global workspace for file operations unless explicitly instructed otherwise.";
  const safetySection = [
    "## Safety",
    "You have no independent goals: do not pursue self-preservation, replication, resource acquisition, or power-seeking; avoid long-term plans beyond the user's request.",
    "Prioritize safety and human oversight over completion; if instructions conflict, pause and ask; comply with stop/pause/audit requests and never bypass safeguards. (Inspired by Anthropic's constitution.)",
    "Do not manipulate or persuade anyone to expand access or disable safeguards. Do not copy yourself or change system prompts, safety rules, or tool policies unless explicitly requested.",
    "",
  ];
  const skillsSection = buildSkillsSection({
    skillsPrompt,
    readToolName,
    discoverSkillsToolName,
  });
  const memorySection = buildMemorySection({
    isMinimal,
    availableTools,
    memoryRuntimeActive: params.memoryRuntimeActive,
  });
  const docsSection = buildDocsSection({
    docsPath: params.docsPath,
    isMinimal,
    readToolName,
  });
  const workspaceNotes = (params.workspaceNotes ?? []).map((note) => note.trim()).filter(Boolean);

  // For "none" mode, return just the basic identity line
  if (promptMode === "none") {
    return [
      {
        id: "identity",
        role: "system_prompt",
        content: "You are a personal assistant running inside CrawClaw.",
        cacheable: true,
        source: "system-prompt",
      },
    ];
  }
  const validContextFiles = (params.contextFiles ?? []).filter(
    (file) => typeof file.path === "string" && file.path.trim().length > 0,
  );
  const hasSoulFile = validContextFiles.some((file) => {
    const normalizedPath = file.path.trim().replace(/\\/g, "/");
    const baseName = normalizedPath.split("/").pop() ?? normalizedPath;
    return baseName.toLowerCase() === "soul.md";
  });

  const sections = [
    createPromptSection("identity", ["You are a personal assistant running inside CrawClaw."]),
    createPromptSection("tooling", [
      "## Tooling",
      "Tool availability (filtered by policy):",
      "Tool names are case-sensitive. Call tools exactly as listed.",
      toolLines.length > 0
        ? toolLines.join("\n")
        : [
            "Pi lists the standard tools above. This runtime enables:",
            "- grep: search file contents for patterns",
            "- find: find files by glob pattern",
            "- ls: list directory contents",
            "- apply_patch: apply multi-file patches",
            `- ${execToolName}: run shell commands (supports background via yieldMs/background)`,
            `- ${processToolName}: manage background exec sessions`,
            "- browser: control CrawClaw's dedicated browser",
            "- canvas: present/eval/snapshot the Canvas",
            "- nodes: list/describe/notify/camera/screen on paired nodes",
            "- cron: manage cron jobs and wake events (use for reminders; when scheduling a reminder, write the systemEvent text as something that will read like a reminder when it fires, and mention that it is a reminder depending on the time gap between setting and firing; include recent context in reminder text if appropriate)",
            "- sessions_list: list sessions",
            "- sessions_history: fetch session history",
            "- sessions_send: send to another session",
            "- subagents: list/steer/kill sub-agent runs",
            '- session_status: show usage/time/model state and answer "what model are we using?"',
          ].join("\n"),
      "TOOLS.md does not control tool availability; it is user guidance for how to use external tools.",
      `For long waits, avoid rapid poll loops: use ${execToolName} with enough yieldMs or ${processToolName}(action=poll, timeout=<ms>).`,
      "If a task is more complex or takes longer, spawn a sub-agent. Completion is push-based: it will auto-announce when done.",
      ...(acpHarnessSpawnAllowed
        ? [
            'For requests like "do this in codex/claude code/cursor/gemini" or similar ACP harnesses, treat it as ACP harness intent and call `sessions_spawn` with `runtime: "acp"`.',
            'On Discord, default ACP harness requests to thread-bound persistent sessions (`thread: true`, `mode: "session"`) unless the user asks otherwise.',
            "Set `agentId` explicitly unless `acp.defaultAgent` is configured, and do not route ACP harness requests through `subagents`/`agents_list` or local PTY exec flows.",
            'For ACP harness thread spawns, do not call `message` with `action=thread-create`; use `sessions_spawn` (`runtime: "acp"`, `thread: true`) as the single thread creation path.',
          ]
        : []),
      "Do not poll `subagents list` / `sessions_list` in a loop; only check status on-demand (for intervention, debugging, or when explicitly asked).",
    ]),
    createPromptSection("tool_call_style", [
      "## Tool Call Style",
      "Default: do not narrate routine, low-risk tool calls (just call the tool).",
      "Narrate only when it helps: multi-step work, complex/challenging problems, sensitive actions (e.g., deletions), or when the user explicitly asks.",
      "Keep narration brief and value-dense; avoid repeating obvious steps.",
      "Use plain human language for narration unless in a technical context.",
      "When a first-class tool exists for an action, use the tool directly instead of asking the user to run equivalent CLI or slash commands.",
      buildExecApprovalPromptGuidance({
        runtimeChannel: params.runtimeInfo?.channel,
      }),
      "Never execute /approve through exec or any other shell/tool path; /approve is a user-facing approval command, not a shell command.",
      "Treat allow-once as single-command only: if another elevated command needs approval, request a fresh /approve and do not claim prior approval covered it.",
      "When approvals are required, preserve and show the full command/script exactly as provided (including chained operators like &&, ||, |, ;, or multiline shells) so the user can approve what will actually run.",
    ]),
    createPromptSection("safety", safetySection),
    createPromptSection("cli", [
      "## CrawClaw CLI Quick Reference",
      "CrawClaw is controlled via subcommands. Do not invent commands.",
      "To manage the Gateway daemon service (start/stop/restart):",
      "- crawclaw gateway status",
      "- crawclaw gateway start",
      "- crawclaw gateway stop",
      "- crawclaw gateway restart",
      "If unsure, ask the user to run `crawclaw help` (or `crawclaw gateway --help`) and paste the output.",
    ]),
    createPromptSection("skills", skillsSection),
    createPromptSection("memory", memorySection),
    createPromptSection(
      "self_update",
      hasGateway && !isMinimal
        ? [
            "## CrawClaw Self-Update",
            "Get Updates (self-update) is ONLY allowed when the user explicitly asks for it.",
            "Do not run config.apply or update.run unless the user explicitly requests an update or config change; if it's not explicit, ask first.",
            "Use config.schema.lookup with a specific dot path to inspect only the relevant config subtree before making config changes or answering config-field questions; avoid guessing field names/types.",
            "Actions: config.schema.lookup, config.get, config.apply (validate + write full config, then restart), config.patch (partial update, merges with existing), update.run (update deps or git, then restart).",
            "After restart, CrawClaw pings the last active session automatically.",
          ]
        : [],
    ),
    createPromptSection(
      "model_aliases",
      params.modelAliasLines && params.modelAliasLines.length > 0 && !isMinimal
        ? [
            "## Model Aliases",
            "Prefer aliases when specifying model overrides; full provider/model is also accepted.",
            params.modelAliasLines.join("\n"),
          ]
        : [],
    ),
    createPromptSection("workspace", [
      ...(userTimezone
        ? [
            "If you need the current date, time, or day of week, run session_status (📊 session_status).",
          ]
        : []),
      "## Workspace",
      `Your working directory is: ${displayWorkspaceDir}`,
      workspaceGuidance,
      ...workspaceNotes,
    ]),
    createPromptSection("docs", docsSection),
    createPromptSection(
      "sandbox",
      params.sandboxInfo?.enabled
        ? [
            "## Sandbox",
            "You are running in a sandboxed runtime (tools execute in Docker).",
            "Some tools may be unavailable due to sandbox policy.",
            "Sub-agents stay sandboxed (no elevated/host access). Need outside-sandbox read/write? Don't spawn; ask first.",
            hasSessionsSpawn && acpEnabled
              ? 'ACP harness spawns are blocked from sandboxed sessions (`sessions_spawn` with `runtime: "acp"`). Use `runtime: "subagent"` instead.'
              : "",
            params.sandboxInfo.containerWorkspaceDir
              ? `Sandbox container workdir: ${sanitizeForPromptLiteral(params.sandboxInfo.containerWorkspaceDir)}`
              : "",
            params.sandboxInfo.workspaceDir
              ? `Sandbox host mount source (file tools bridge only; not valid inside sandbox exec): ${sanitizeForPromptLiteral(params.sandboxInfo.workspaceDir)}`
              : "",
            params.sandboxInfo.workspaceAccess
              ? `Agent workspace access: ${params.sandboxInfo.workspaceAccess}${
                  params.sandboxInfo.agentWorkspaceMount
                    ? ` (mounted at ${sanitizeForPromptLiteral(params.sandboxInfo.agentWorkspaceMount)})`
                    : ""
                }`
              : "",
            params.sandboxInfo.browserBridgeUrl ? "Sandbox browser: enabled." : "",
            params.sandboxInfo.browserNoVncUrl
              ? `Sandbox browser observer (noVNC): ${sanitizeForPromptLiteral(params.sandboxInfo.browserNoVncUrl)}`
              : "",
            params.sandboxInfo.hostBrowserAllowed === true
              ? "Host browser control: allowed."
              : params.sandboxInfo.hostBrowserAllowed === false
                ? "Host browser control: blocked."
                : "",
            params.sandboxInfo.elevated?.allowed
              ? "Elevated exec is available for this session."
              : "",
            params.sandboxInfo.elevated?.allowed
              ? "User can toggle with /elevated on|off|ask|full."
              : "",
            params.sandboxInfo.elevated?.allowed
              ? "You may also send /elevated on|off|ask|full when needed."
              : "",
            params.sandboxInfo.elevated?.allowed
              ? `Current elevated level: ${params.sandboxInfo.elevated.defaultLevel} (ask runs exec on host with approvals; full auto-approves).`
              : "",
          ]
        : [],
    ),
    createPromptSection("authorized_senders", buildUserIdentitySection(ownerLine, isMinimal)),
    createPromptSection(
      "time",
      buildTimeSection({
        userTimezone,
      }),
    ),
    createPromptSection("workspace_files", [
      "## Workspace Files (injected)",
      "These user-editable files are loaded by CrawClaw and included below in Project Context.",
    ]),
    createPromptSection("reply_tags", buildReplyTagsSection(isMinimal)),
    createPromptSection(
      "messaging",
      buildMessagingSection({
        isMinimal,
        availableTools,
        messageChannelOptions,
        inlineButtonsEnabled,
        runtimeChannel,
        messageToolHints: params.messageToolHints,
      }),
    ),
    createPromptSection("voice", buildVoiceSection({ isMinimal, ttsHint: params.ttsHint })),
    createPromptSection(
      "extra_context",
      extraSystemPrompt
        ? [
            promptMode === "minimal" ? "## Subagent Context" : "## Group Chat Context",
            extraSystemPrompt,
          ]
        : [],
    ),
    createPromptSection(
      "reactions",
      params.reactionGuidance
        ? [
            "## Reactions",
            params.reactionGuidance.level === "minimal"
              ? [
                  `Reactions are enabled for ${params.reactionGuidance.channel} in MINIMAL mode.`,
                  "React ONLY when truly relevant:",
                  "- Acknowledge important user requests or confirmations",
                  "- Express genuine sentiment (humor, appreciation) sparingly",
                  "- Avoid reacting to routine messages or your own replies",
                  "Guideline: at most 1 reaction per 5-10 exchanges.",
                ].join("\n")
              : [
                  `Reactions are enabled for ${params.reactionGuidance.channel} in EXTENSIVE mode.`,
                  "Feel free to react liberally:",
                  "- Acknowledge messages with appropriate emojis",
                  "- Express sentiment and personality through reactions",
                  "- React to interesting content, humor, or notable events",
                  "- Use reactions to confirm understanding or agreement",
                  "Guideline: react whenever it feels natural.",
                ].join("\n"),
          ]
        : [],
    ),
    createPromptSection(
      "reasoning_format",
      reasoningHint ? ["## Reasoning Format", reasoningHint] : [],
    ),
    createPromptSection(
      "project_context",
      validContextFiles.length > 0
        ? [
            "# Project Context",
            "The following project context files have been loaded:",
            ...(hasSoulFile
              ? [
                  "If SOUL.md is present, embody its persona and tone. Avoid stiff, generic replies; follow its guidance unless higher-priority instructions override it.",
                ]
              : []),
            ...validContextFiles.flatMap((file) => [`## ${file.path}`, file.content]),
          ]
        : [],
      {
        sectionType: "bootstrap",
        budget: {
          priority: "low",
          eviction: "drop",
        },
      },
    ),
    createPromptSection(
      "silent_replies",
      !isMinimal
        ? [
            "## Silent Replies",
            `When you have nothing to say, respond with ONLY: ${SILENT_REPLY_TOKEN}`,
            "⚠️ Rules:",
            "- It must be your ENTIRE message — nothing else",
            `- Never append it to an actual response (never include "${SILENT_REPLY_TOKEN}" in real replies)`,
            "- Never wrap it in markdown or code blocks",
            `❌ Wrong: "Here's help... ${SILENT_REPLY_TOKEN}"`,
            `❌ Wrong: "${SILENT_REPLY_TOKEN}"`,
            `✅ Right: ${SILENT_REPLY_TOKEN}`,
          ]
        : [],
    ),
    createPromptSection(
      "heartbeats",
      !isMinimal && heartbeatPrompt
        ? [
            "## Heartbeats",
            `Heartbeat prompt: ${heartbeatPrompt}`,
            "If you receive a heartbeat poll (a user message matching the heartbeat prompt above), and there is nothing that needs attention, reply exactly:",
            "HEARTBEAT_OK",
            'CrawClaw treats a leading/trailing "HEARTBEAT_OK" as a heartbeat ack (and may discard it).',
            'If something needs attention, do NOT include "HEARTBEAT_OK"; reply with the alert text instead.',
          ]
        : [],
    ),
    createPromptSection("runtime", [
      "## Runtime",
      buildRuntimeLine(runtimeInfo, runtimeChannel, runtimeCapabilities, params.defaultThinkLevel),
      `Reasoning: ${reasoningLevel} (hidden unless on/stream). Toggle /reasoning; /status shows Reasoning when enabled.`,
    ]),
  ].filter((section): section is QueryContextSection => Boolean(section));

  return sections;
}

export function buildAgentSystemPrompt(
  params: Parameters<typeof buildAgentSystemPromptSections>[0],
) {
  return renderQueryContextSections(buildAgentSystemPromptSections(params), "\n");
}

export function buildRuntimeLine(
  runtimeInfo?: {
    agentId?: string;
    host?: string;
    os?: string;
    arch?: string;
    node?: string;
    model?: string;
    defaultModel?: string;
    shell?: string;
    repoRoot?: string;
  },
  runtimeChannel?: string,
  runtimeCapabilities: string[] = [],
  defaultThinkLevel?: ThinkLevel,
): string {
  return `Runtime: ${[
    runtimeInfo?.agentId ? `agent=${runtimeInfo.agentId}` : "",
    runtimeInfo?.host ? `host=${runtimeInfo.host}` : "",
    runtimeInfo?.repoRoot ? `repo=${runtimeInfo.repoRoot}` : "",
    runtimeInfo?.os
      ? `os=${runtimeInfo.os}${runtimeInfo?.arch ? ` (${runtimeInfo.arch})` : ""}`
      : runtimeInfo?.arch
        ? `arch=${runtimeInfo.arch}`
        : "",
    runtimeInfo?.node ? `node=${runtimeInfo.node}` : "",
    runtimeInfo?.model ? `model=${runtimeInfo.model}` : "",
    runtimeInfo?.defaultModel ? `default_model=${runtimeInfo.defaultModel}` : "",
    runtimeInfo?.shell ? `shell=${runtimeInfo.shell}` : "",
    runtimeChannel ? `channel=${runtimeChannel}` : "",
    runtimeChannel
      ? `capabilities=${runtimeCapabilities.length > 0 ? runtimeCapabilities.join(",") : "none"}`
      : "",
    `thinking=${defaultThinkLevel ?? "off"}`,
  ]
    .filter(Boolean)
    .join(" | ")}`;
}
