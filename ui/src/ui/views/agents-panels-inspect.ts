import { html, nothing } from "lit";
import type { AgentInspectionSnapshot, AgentInspectionTimelineEntry } from "../types.ts";
import { formatPercent, formatRelativeTimestamp, formatTokens } from "../format.ts";
import { uiLiteral } from "../ui-literal.ts";

const DECISION_CODE_LABELS: Record<string, string> = {
  provider_model_selected: "Provider model selected",
  compact_auto_triggered: "Auto compaction triggered",
  compact_manual_triggered: "Manual compaction triggered",
  compact_retry_triggered: "Retry compaction triggered",
  prompt_cache_hit: "Prompt cache hit",
  prompt_cache_miss: "Prompt cache miss",
  prompt_cache_skip_write: "Prompt cache write skipped",
  prompt_cache_write: "Prompt cache written",
  session_memory_selected: "Session memory selected",
  durable_memory_selected: "Durable memory selected",
  durable_memory_prefetch_hit: "Durable prefetch hit",
  durable_memory_prefetch_wait_hit: "Durable wait hit",
  durable_memory_prefetch_pending_fallback: "Durable pending fallback",
};

function formatTimestamp(ts: number | undefined): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) {
    return uiLiteral("unknown");
  }
  return `${new Date(ts).toLocaleString()} (${formatRelativeTimestamp(ts)})`;
}

function formatDecisionCode(code: string | undefined): string {
  if (!code) {
    return uiLiteral("—");
  }
  return uiLiteral(DECISION_CODE_LABELS[code] ?? code.replace(/_/g, " "));
}

function renderKeyValue(label: string, value: unknown) {
  const text =
    value === null || value === undefined || value === ""
      ? "—"
      : typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : JSON.stringify(value);
  return html`
    <div class="agent-kv">
      <div class="label">${label}</div>
      <div class="mono">${text}</div>
    </div>
  `;
}

function renderInlineMap(map: Record<string, unknown> | undefined) {
  if (!map || Object.keys(map).length === 0) {
    return html`<div class="muted">${uiLiteral("None")}</div>`;
  }
  return html`
    <div class="agents-overview-grid">
      ${Object.entries(map).map(([key, value]) =>
        renderKeyValue(key, typeof value === "string" ? formatDecisionCode(value) : value),
      )}
    </div>
  `;
}

function renderTokenBreakdown(
  title: string,
  usage: Record<string, number> | undefined,
  total: number | undefined,
) {
  const rows = Object.entries(usage ?? {})
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value) && value > 0)
    .toSorted((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  if (rows.length === 0) {
    return html`
      <section class="card">
        <div class="card-title">${title}</div>
        <div class="card-sub">${uiLiteral("No token usage recorded.")}</div>
      </section>
    `;
  }
  const denominator =
    typeof total === "number" && Number.isFinite(total) && total > 0
      ? total
      : rows.reduce((sum, [, value]) => sum + value, 0);
  return html`
    <section class="card">
      <div class="card-title">${title}</div>
      <div class="card-sub">${uiLiteral("Relative share of estimated tokens in this request.")}</div>
      <div class="list" style="margin-top: 12px;">
        ${rows.map(([name, value]) => {
          const ratio = denominator > 0 ? value / denominator : 0;
          return html`
            <div class="list-item">
              <div class="list-main">
                <div class="list-title">${name}</div>
                <div
                  style="margin-top: 8px; height: 8px; border-radius: 999px; background: var(--surface-2, rgba(127,127,127,0.12)); overflow: hidden;"
                >
                  <div
                    style="height: 100%; width: ${Math.max(4, ratio * 100)}%; background: var(--accent, #4f7cff); border-radius: 999px;"
                  ></div>
                </div>
              </div>
              <div class="list-meta mono">
                ${formatTokens(value)} · ${formatPercent(ratio)}
              </div>
            </div>
          `;
        })}
      </div>
    </section>
  `;
}

function renderMemoryRecallSummary(
  recall:
    | {
        selectedItemIds?: string[];
        omittedItemIds?: string[];
        hitReason?: string;
        evictionReason?: string;
        durableRecallSource?: string;
        decisionCodes?: Record<string, string>;
      }
    | undefined,
) {
  if (!recall) {
    return html`<div class="muted">${uiLiteral("No memory recall diagnostics.")}</div>`;
  }
  const selectedCount = recall.selectedItemIds?.length ?? 0;
  const omittedCount = recall.omittedItemIds?.length ?? 0;
  return html`
    <div class="agents-overview-grid">
      ${renderKeyValue(uiLiteral("Hit reason"), recall.hitReason ? formatDecisionCode(recall.hitReason) : uiLiteral("—"))}
      ${renderKeyValue(
        uiLiteral("Eviction reason"),
        recall.evictionReason ? formatDecisionCode(recall.evictionReason) : uiLiteral("—"),
      )}
      ${renderKeyValue(
        uiLiteral("Durable source"),
        recall.durableRecallSource ? formatDecisionCode(recall.durableRecallSource) : uiLiteral("—"),
      )}
      ${renderKeyValue(uiLiteral("Selected items"), selectedCount)}
      ${renderKeyValue(uiLiteral("Omitted items"), omittedCount)}
    </div>
  `;
}

function renderChannelStreamingDecisions(
  decisions:
    | Array<{
        ts: number;
        channel: string;
        accountId?: string;
        chatId?: string | number;
        surface: "none" | "draft_stream" | "editable_draft_stream" | "card_stream";
        enabled: boolean;
        reason:
          | "enabled"
          | "disabled_by_config"
          | "disabled_for_render_mode"
          | "disabled_for_thread_reply";
      }>
    | undefined,
) {
  if (!decisions || decisions.length === 0) {
    return html`<div class="muted">${uiLiteral("No channel streaming decisions recorded.")}</div>`;
  }
  return html`
    <div class="list">
      ${decisions.map(
        (decision) => html`
          <div class="list-item">
            <div class="list-main">
              <div class="list-title">
                ${decision.channel}
                <span class="chip" style="margin-left: 8px"
                  >${decision.enabled ? uiLiteral("streaming") : uiLiteral("fallback")}</span
                >
              </div>
              <div class="list-sub">
                ${formatDecisionCode(decision.reason)} · ${decision.surface}
                ${decision.accountId ? ` · ${uiLiteral("account")} ${decision.accountId}` : ""}
                ${decision.chatId !== undefined ? ` · ${uiLiteral("chat")} ${decision.chatId}` : ""}
              </div>
              <div class="muted" style="margin-top: 6px;">${formatTimestamp(decision.ts)}</div>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function summarizeTimeline(
  timeline: AgentInspectionTimelineEntry[],
): {
  phases: Array<{ name: string; count: number }>;
  statuses: Array<{ name: string; count: number }>;
} {
  const phaseCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  for (const entry of timeline) {
    const phase = (entry.phase ?? entry.type).trim();
    phaseCounts.set(phase, (phaseCounts.get(phase) ?? 0) + 1);
    if (entry.status) {
      statusCounts.set(entry.status, (statusCounts.get(entry.status) ?? 0) + 1);
    }
  }
  return {
    phases: [...phaseCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    statuses: [...statusCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .toSorted((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
  };
}

function filterTimeline(
  timeline: AgentInspectionTimelineEntry[],
  filter: "all" | "errors" | "decisions",
): AgentInspectionTimelineEntry[] {
  if (filter === "errors") {
    return timeline.filter(
      (entry) =>
        entry.status === "error" ||
        entry.status === "failed" ||
        entry.type.endsWith("_error") ||
        (entry.summary?.toLowerCase().includes("error") ?? false),
    );
  }
  if (filter === "decisions") {
    return timeline.filter((entry) => Boolean(entry.decisionCode));
  }
  return timeline;
}

function renderTimelineEntry(entry: AgentInspectionTimelineEntry) {
  return html`
    <div class="list-item">
      <div class="list-main">
        <div class="list-title">
          ${entry.phase ?? entry.type}
          ${entry.status
            ? html`<span class="chip" style="margin-left: 8px">${uiLiteral(entry.status)}</span>`
            : nothing}
          ${entry.decisionCode
            ? html`
                <span class="chip" style="margin-left: 8px" title=${entry.decisionCode}
                  >${formatDecisionCode(entry.decisionCode)}</span
                >
              `
            : nothing}
        </div>
        <div class="list-sub">${entry.summary}</div>
        <div class="muted" style="margin-top: 6px;">
          ${formatTimestamp(entry.createdAt)}
          ${entry.spanId ? html` · ${uiLiteral("span")} ${entry.spanId}` : nothing}
          ${entry.parentSpanId ? html` · ${uiLiteral("parent")} ${entry.parentSpanId}` : nothing}
        </div>
      </div>
      <div class="list-meta" style="min-width: 280px;">
        ${entry.metrics && Object.keys(entry.metrics).length > 0
          ? html`
              <div class="mono" style="white-space: pre-wrap;">${Object.entries(entry.metrics)
                .map(([key, value]) => `${key}: ${value}`)
                .join("\n")}</div>
            `
          : html`<div class="muted">${uiLiteral("No metrics")}</div>`}
      </div>
    </div>
  `;
}

function renderSectionOrder(
  sections:
    | Array<{ id: string; role: string; sectionType: string; estimatedTokens: number; source?: string }>
    | undefined,
) {
  if (!sections || sections.length === 0) {
    return html`<div class="muted">${uiLiteral("No section order recorded.")}</div>`;
  }
  return html`
    <div class="list">
      ${sections.map(
        (section) => html`
          <div class="list-item">
            <div class="list-main">
              <div class="list-title">${section.id}</div>
              <div class="list-sub">
                ${section.role} · ${section.sectionType}
                ${section.source ? ` · ${section.source}` : ""}
              </div>
            </div>
            <div class="list-meta mono">${section.estimatedTokens} tok</div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderSectionOrderGrouped(
  sections:
    | Array<{ id: string; role: string; sectionType: string; estimatedTokens: number; source?: string }>
    | undefined,
) {
  if (!sections || sections.length === 0) {
    return html`<div class="muted">${uiLiteral("No section order recorded.")}</div>`;
  }
  const grouped = new Map<
    string,
    Array<{ id: string; role: string; sectionType: string; estimatedTokens: number; source?: string }>
  >();
  for (const section of sections) {
    const key = section.role;
    const items = grouped.get(key) ?? [];
    items.push(section);
    grouped.set(key, items);
  }
  return html`
    <div class="grid grid-cols-2">
      ${[...grouped.entries()].map(
        ([role, items]) => html`
          <section class="card">
            <div class="card-title">${role}</div>
            <div class="card-sub">${items.length} ${uiLiteral(items.length === 1 ? "section" : "sections")}</div>
            <div style="margin-top: 12px;">${renderSectionOrder(items)}</div>
          </section>
        `,
      )}
    </div>
  `;
}

function renderHookMutations(
  hookMutations:
    | Array<{
        hook: string;
        prependUserContextSections: number;
        appendUserContextSections: number;
        prependSystemContextSections: number;
        appendSystemContextSections: number;
        replaceSystemPromptSections: number;
        clearSystemContextSections: boolean;
        replaceUserPrompt: boolean;
      }>
    | undefined,
) {
  if (!hookMutations || hookMutations.length === 0) {
    return html`<div class="muted">${uiLiteral("No hook mutations recorded.")}</div>`;
  }
  return html`
    <div class="list">
      ${hookMutations.map(
        (item) => html`
          <div class="list-item">
            <div class="list-main">
              <div class="list-title">${item.hook}</div>
              <div class="list-sub">
                ${uiLiteral("user")}(+${item.prependUserContextSections} / +${item.appendUserContextSections})
                · ${uiLiteral("system")}(+${item.prependSystemContextSections} / +${item.appendSystemContextSections})
              </div>
            </div>
            <div class="list-meta mono">
              ${uiLiteral("replaceSystemPrompt")}=${item.replaceSystemPromptSections}
              <br />
              ${uiLiteral("clearSystem")}=${item.clearSystemContextSections ? uiLiteral("yes") : uiLiteral("no")}
              <br />
              ${uiLiteral("replaceUserPrompt")}=${item.replaceUserPrompt ? uiLiteral("yes") : uiLiteral("no")}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

export function renderAgentInspect(params: {
  loading: boolean;
  error: string | null;
  snapshot: AgentInspectionSnapshot | null;
  timelineFilter: "all" | "errors" | "decisions";
  selectedAgentId: string;
  currentRunId: string | null;
  currentRunMatchesSelectedAgent: boolean;
  onRefresh: () => void;
  onInspectCurrentRun: () => void;
  onTimelineFilterChange: (next: "all" | "errors" | "decisions") => void;
}) {
  const snapshot = params.snapshot;
  const timeline = snapshot?.timeline ?? [];
  const filteredTimeline = filterTimeline(timeline, params.timelineFilter);
  const timelineSummary = summarizeTimeline(timeline);
  const queryContext = snapshot?.queryContext;
  const providerRequest = queryContext?.providerRequestSnapshot;
  const tokenUsage = providerRequest?.sectionTokenUsage;
  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">${uiLiteral("Runtime Inspect")}</div>
          <div class="card-sub">${uiLiteral("Timeline, query context, and provider request diagnostics.")}</div>
        </div>
        <div class="row" style="gap: 8px;">
          <button class="btn btn--sm" @click=${params.onInspectCurrentRun}>
            ${uiLiteral("Use Current Run")}
          </button>
          <button class="btn btn--sm" ?disabled=${params.loading} @click=${params.onRefresh}>
            ${params.loading ? uiLiteral("Refreshing…") : uiLiteral("Refresh")}
          </button>
        </div>
      </div>

      ${params.error
        ? html`<div class="callout danger" style="margin-top: 12px;">${params.error}</div>`
        : nothing}

      ${!snapshot
        ? html`
            <div class="callout info" style="margin-top: 12px;">
              ${params.currentRunId && params.currentRunMatchesSelectedAgent
                ? uiLiteral("Load the current run to inspect runtime timeline and context.")
                : `${uiLiteral("No active run is available for agent")} "${params.selectedAgentId}".`}
            </div>
          `
        : html`
            <div class="agents-overview-grid" style="margin-top: 16px;">
              ${renderKeyValue(uiLiteral("Run ID"), snapshot.runId)}
              ${renderKeyValue(uiLiteral("Task ID"), snapshot.taskId)}
              ${renderKeyValue(uiLiteral("Runtime State"), snapshot.runtimeState?.status ? uiLiteral(snapshot.runtimeState.status) : snapshot.runtimeState?.status)}
              ${renderKeyValue(uiLiteral("Completion"), snapshot.completion?.status ? uiLiteral(snapshot.completion.status) : snapshot.completion?.status)}
              ${renderKeyValue(uiLiteral("Warnings"), snapshot.warnings.length)}
              ${renderKeyValue(uiLiteral("Archive Runs"), snapshot.archive?.runs.length ?? 0)}
            </div>

            <section class="card" style="margin-top: 16px;">
              <div class="card-title">${uiLiteral("Timeline")}</div>
              <div class="card-sub">${uiLiteral("Structured lifecycle and provider/tool/subagent events.")}</div>
              <div class="row" style="gap: 8px; margin-top: 12px;">
                ${([
                  ["all", uiLiteral("All")],
                  ["errors", uiLiteral("Errors")],
                  ["decisions", uiLiteral("Decisions")],
                ] as const).map(
                  ([value, label]) => html`
                    <button
                      class="btn btn--sm ${params.timelineFilter === value ? "primary" : "btn--ghost"}"
                      type="button"
                      @click=${() => params.onTimelineFilterChange(value)}
                    >
                      ${label}
                    </button>
                  `,
                )}
              </div>
              ${timeline.length > 0
                ? html`
                    <div class="grid grid-cols-2" style="margin-top: 12px;">
                      <section class="card">
                        <div class="card-title">${uiLiteral("Phases")}</div>
                        <div class="card-sub">${uiLiteral("Top event groups in this run.")}</div>
                        <div class="list" style="margin-top: 12px;">
                          ${timelineSummary.phases.slice(0, 8).map(
                            (entry) => html`
                              <div class="list-item">
                                <div class="list-main">
                                  <div class="list-title">${entry.name}</div>
                                </div>
                                <div class="list-meta mono">${entry.count}</div>
                              </div>
                            `,
                          )}
                        </div>
                      </section>
                      <section class="card">
                        <div class="card-title">${uiLiteral("Statuses")}</div>
                        <div class="card-sub">${uiLiteral("Outcome mix across lifecycle events.")}</div>
                        <div class="list" style="margin-top: 12px;">
                          ${timelineSummary.statuses.length === 0
                            ? html`<div class="muted">${uiLiteral("No explicit statuses.")}</div>`
                            : timelineSummary.statuses.map(
                                (entry) => html`
                                  <div class="list-item">
                                    <div class="list-main">
                                      <div class="list-title">${entry.name}</div>
                                    </div>
                                    <div class="list-meta mono">${entry.count}</div>
                                  </div>
                                `,
                              )}
                        </div>
                      </section>
                    </div>
                  `
                : nothing}
              ${filteredTimeline.length === 0
                ? html`<div class="muted" style="margin-top: 12px;">${uiLiteral("No timeline events.")}</div>`
                : html`
                    <div class="muted" style="margin-top: 12px;">
                      ${uiLiteral("Showing")} ${filteredTimeline.length} ${uiLiteral("of")} ${timeline.length} ${uiLiteral("events.")}
                    </div>
                    <div class="list" style="margin-top: 12px;">
                      ${filteredTimeline.map(renderTimelineEntry)}
                    </div>
                  `}
            </section>

            <section class="grid grid-cols-2" style="margin-top: 16px;">
              <section class="card">
                <div class="card-title">${uiLiteral("Query Context")}</div>
                <div class="card-sub">${uiLiteral("Archive-backed context assembly diagnostics.")}</div>
                <div class="agents-overview-grid" style="margin-top: 12px;">
                  ${renderKeyValue(uiLiteral("Context Hash"), queryContext?.queryContextHash)}
                  ${renderKeyValue(uiLiteral("Archive Run ID"), queryContext?.archiveRunId)}
                  ${renderKeyValue(uiLiteral("Event ID"), queryContext?.eventId)}
                  ${renderKeyValue(uiLiteral("System Sections"), queryContext?.systemContextSectionCount)}
                </div>
                <div style="margin-top: 12px;">
                  <div class="label">${uiLiteral("Decision Codes")}</div>
                  ${renderInlineMap(queryContext?.decisionCodes)}
                </div>
                <div style="margin-top: 12px;">
                  <div class="label">${uiLiteral("Hook Mutations")}</div>
                  ${renderHookMutations(queryContext?.hookMutations)}
                </div>
                <div style="margin-top: 12px;">
                  <div class="label">${uiLiteral("Memory Recall")}</div>
                  ${renderMemoryRecallSummary(queryContext?.memoryRecall)}
                </div>
                <div style="margin-top: 12px;">
                  <div class="label">${uiLiteral("Memory Recall Decision Codes")}</div>
                  ${renderInlineMap(queryContext?.memoryRecall?.decisionCodes)}
                </div>
              </section>

              <section class="card">
                <div class="card-title">${uiLiteral("Provider Request")}</div>
                <div class="card-sub">${uiLiteral("Final request snapshot derived from query context.")}</div>
                <div class="agents-overview-grid" style="margin-top: 12px;">
                  ${renderKeyValue(uiLiteral("Context Hash"), providerRequest?.queryContextHash)}
                  ${renderKeyValue(uiLiteral("Prompt Chars"), providerRequest?.promptChars)}
                  ${renderKeyValue(uiLiteral("System Prompt Chars"), providerRequest?.systemPromptChars)}
                  ${renderKeyValue(
                    uiLiteral("Estimated Tokens"),
                    providerRequest?.sectionTokenUsage.totalEstimatedTokens,
                  )}
                </div>
                <div style="margin-top: 12px;">
                  <div class="label">${uiLiteral("Decision Codes")}</div>
                  ${renderInlineMap(providerRequest?.decisionCodes)}
                </div>
                <div style="margin-top: 12px;">
                  <div class="label">${uiLiteral("Section Tokens by Role")}</div>
                  ${renderInlineMap(providerRequest?.sectionTokenUsage.byRole)}
                </div>
              </section>
            </section>

            <section class="grid grid-cols-2" style="margin-top: 16px;">
              ${renderTokenBreakdown(
                uiLiteral("Tokens by Role"),
                tokenUsage?.byRole,
                tokenUsage?.totalEstimatedTokens,
              )}
              ${renderTokenBreakdown(
                uiLiteral("Tokens by Type"),
                tokenUsage?.byType,
                tokenUsage?.totalEstimatedTokens,
              )}
            </section>

            <section class="card" style="margin-top: 16px;">
              <div class="card-title">${uiLiteral("Provider Section Order")}</div>
              <div class="card-sub">${uiLiteral("Ordered sections sent into provider materialization.")}</div>
              <div style="margin-top: 12px;">
                ${renderSectionOrderGrouped(providerRequest?.sectionOrder)}
              </div>
            </section>

            <section class="grid grid-cols-2" style="margin-top: 16px;">
              <section class="card">
                <div class="card-title">${uiLiteral("Warnings")}</div>
                <div class="card-sub">${uiLiteral("Inspection and runtime warnings.")}</div>
                ${snapshot.warnings.length === 0
                  ? html`<div class="muted" style="margin-top: 12px;">${uiLiteral("No warnings.")}</div>`
                  : html`
                      <div class="list" style="margin-top: 12px;">
                        ${snapshot.warnings.map(
                          (warning) => html`
                            <div class="list-item">
                              <div class="list-main">
                                <div class="list-sub">${warning}</div>
                              </div>
                            </div>
                          `,
                        )}
                      </div>
                    `}
              </section>

              <section class="card">
                <div class="card-title">${uiLiteral("Refs")}</div>
                <div class="card-sub">${uiLiteral("Runtime and archive references for deep debugging.")}</div>
                <div style="margin-top: 12px;">${renderInlineMap(snapshot.refs)}</div>
              </section>
            </section>

            <section class="card" style="margin-top: 16px;">
              <div class="card-title">${uiLiteral("Channel Streaming")}</div>
              <div class="card-sub">
                ${uiLiteral("Recent per-channel streaming decisions captured during runtime.")}
              </div>
              <div style="margin-top: 12px;">
                ${renderChannelStreamingDecisions(snapshot.channelStreaming?.recentDecisions)}
              </div>
            </section>
          `}
    </section>
  `;
}
