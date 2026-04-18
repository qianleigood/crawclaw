import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  ModelCatalogEntry,
  SkillStatusReport,
  ToolsCatalogResult,
  ToolsEffectiveResult,
} from "../types.ts";
import { uiLiteral } from "../ui-literal.ts";
import { renderAgentInspect } from "./agents-panels-inspect.ts";
import { renderAgentOverview } from "./agents-panels-overview.ts";
import {
  renderAgentFiles,
  renderAgentChannels,
  renderAgentCron,
} from "./agents-panels-status-files.ts";
import { renderAgentTools, renderAgentSkills } from "./agents-panels-tools-skills.ts";
import { agentBadgeText, buildAgentContext, normalizeAgentLabel } from "./agents-utils.ts";

export type AgentsPanel =
  | "overview"
  | "inspect"
  | "files"
  | "tools"
  | "skills"
  | "channels"
  | "cron";

export type ConfigState = {
  form: Record<string, unknown> | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
};

export type ChannelsState = {
  snapshot: ChannelsStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  lastSuccess: number | null;
};

export type CronState = {
  status: CronStatus | null;
  jobs: CronJob[];
  loading: boolean;
  error: string | null;
};

export type AgentFilesState = {
  list: AgentsFilesListResult | null;
  loading: boolean;
  error: string | null;
  active: string | null;
  contents: Record<string, string>;
  drafts: Record<string, string>;
  saving: boolean;
};

export type AgentSkillsState = {
  report: SkillStatusReport | null;
  loading: boolean;
  error: string | null;
  agentId: string | null;
  filter: string;
};

export type ToolsCatalogState = {
  loading: boolean;
  error: string | null;
  result: ToolsCatalogResult | null;
};

export type ToolsEffectiveState = {
  loading: boolean;
  error: string | null;
  result: ToolsEffectiveResult | null;
};

export type AgentInspectState = {
  loading: boolean;
  error: string | null;
  runId: string | null;
  taskId: string | null;
  timelineFilter: "all" | "errors" | "decisions";
  snapshot: import("../types.ts").AgentInspectionSnapshot | null;
};

export type AgentsProps = {
  uiMode?: "simple" | "advanced";
  basePath: string;
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  config: ConfigState;
  channels: ChannelsState;
  cron: CronState;
  agentFiles: AgentFilesState;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkills: AgentSkillsState;
  toolsCatalog: ToolsCatalogState;
  toolsEffective: ToolsEffectiveState;
  inspect: AgentInspectState;
  runtimeSessionKey: string;
  runtimeSessionMatchesSelectedAgent: boolean;
  runtimeRunId: string | null;
  modelCatalog: ModelCatalogEntry[];
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onChannelsRefresh: () => void;
  onCronRefresh: () => void;
  onCronRunNow: (jobId: string) => void;
  onSkillsFilterChange: (next: string) => void;
  onSkillsRefresh: () => void;
  onAgentSkillToggle: (agentId: string, skillName: string, enabled: boolean) => void;
  onAgentSkillsClear: (agentId: string) => void;
  onAgentSkillsDisableAll: (agentId: string) => void;
  onSetDefault: (agentId: string) => void;
  onInspectRefresh: () => void;
  onInspectCurrentRun: () => void;
  onInspectTimelineFilterChange: (next: "all" | "errors" | "decisions") => void;
};

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;
  const uiMode = props.uiMode === "advanced" ? "advanced" : "simple";
  const activePanel =
    uiMode === "advanced" || props.activePanel !== "inspect" ? props.activePanel : "overview";
  const selectedSkillCount =
    selectedId && props.agentSkills.agentId === selectedId
      ? (props.agentSkills.report?.skills?.length ?? null)
      : null;

  const channelEntryCount = props.channels.snapshot
    ? Object.keys(props.channels.snapshot.channelAccounts ?? {}).length
    : null;
  const cronJobCount = selectedId
    ? props.cron.jobs.filter((j) => j.agentId === selectedId).length
    : null;
  const tabCounts: Record<string, number | null> = {
    files: props.agentFiles.list?.files?.length ?? null,
    skills: selectedSkillCount,
    channels: channelEntryCount,
    cron: cronJobCount || null,
  };
  const runtimeRunLabel =
    props.runtimeSessionMatchesSelectedAgent && props.runtimeRunId
      ? props.runtimeRunId
      : uiLiteral("No active run");
  const inspectState = props.inspect.loading
    ? uiLiteral("Loading")
    : props.inspect.snapshot
      ? uiLiteral("Ready")
      : props.inspect.error
        ? uiLiteral("Attention")
        : uiLiteral("Idle");
  const configState = props.config.saving
    ? uiLiteral("Saving")
    : props.config.dirty
      ? uiLiteral("Apply required")
      : uiLiteral("In sync");
  const skillsState = props.agentSkills.loading
    ? uiLiteral("Loading")
    : props.agentSkills.error
      ? uiLiteral("Attention")
      : selectedSkillCount != null
        ? uiLiteral("Ready")
        : uiLiteral("Idle");

  return html`
    <section class="control-console-stage control-console-stage--agents">
      <section class="control-console-head">
        <div class="control-console-head__top">
          <div class="control-console-head__copy">
            <div class="control-console-head__eyebrow">${uiLiteral("Control plane agents")}</div>
            <h1 class="control-console-head__title">${uiLiteral("Agent control")}</h1>
            <p class="control-console-head__summary">
              ${uiLiteral(
                "Inspect agent identity, runtime session, tools, skills, files, and cron state from one operator-focused control surface.",
              )}
            </p>
          </div>
          <div class="control-console-head__actions">
            <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? t("skillsPage.loading") : t("common.refresh")}
            </button>
          </div>
        </div>
        <div class="control-console-head__meta">
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Registry selection")}</span>
            <strong class="control-console-head__meta-value"
              >${selectedAgent
                ? normalizeAgentLabel(selectedAgent)
                : t("agentsPage.noAgents")}</strong
            >
            <span class="control-console-head__meta-note"
              >${selectedId ?? uiLiteral("Select an agent from the registry rail.")}</span
            >
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Runtime")}</span>
            <strong class="control-console-head__meta-value">${runtimeRunLabel}</strong>
            <span class="control-console-head__meta-note"
              >${props.runtimeSessionKey || uiLiteral("No runtime session bound")}</span
            >
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Inspect")}</span>
            <strong class="control-console-head__meta-value">${inspectState}</strong>
            <span class="control-console-head__meta-note"
              >${props.inspect.runId ?? uiLiteral("No inspect run pinned")}</span
            >
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Config / skills")}</span>
            <strong class="control-console-head__meta-value">${configState}</strong>
            <span class="control-console-head__meta-note"
              >${selectedSkillCount != null
                ? `${selectedSkillCount} ${uiLiteral("skills visible for this agent")}`
                : uiLiteral("Load the skills panel to inspect effective skill state")}</span
            >
          </div>
        </div>
      </section>
      <div class="agents-layout">
        <section class="agents-toolbar operations-panel">
          <div class="agents-toolbar-row">
            <div class="agents-control-select">
              <select
                class="agents-select"
                .value=${selectedId ?? ""}
                ?disabled=${props.loading || agents.length === 0}
                @change=${(e: Event) => props.onSelectAgent((e.target as HTMLSelectElement).value)}
              >
                ${agents.length === 0
                  ? html` <option value="">${t("agentsPage.noAgents")}</option> `
                  : agents.map(
                      (agent) => html`
                        <option value=${agent.id} ?selected=${agent.id === selectedId}>
                          ${normalizeAgentLabel(agent)}${agentBadgeText(agent.id, defaultId)
                            ? ` (${agentBadgeText(agent.id, defaultId)})`
                            : ""}
                        </option>
                      `,
                    )}
              </select>
            </div>
            <div class="agents-toolbar-actions">
              ${selectedAgent
                ? html`
                    <button
                      type="button"
                      class="btn btn--sm btn--ghost"
                      @click=${() => void navigator.clipboard.writeText(selectedAgent.id)}
                      title=${t("agentsPage.copyIdTitle")}
                    >
                      ${t("agentsPage.copyId")}
                    </button>
                    <button
                      type="button"
                      class="btn btn--sm btn--ghost"
                      ?disabled=${Boolean(defaultId && selectedAgent.id === defaultId)}
                      @click=${() => props.onSetDefault(selectedAgent.id)}
                      title=${defaultId && selectedAgent.id === defaultId
                        ? t("agentsPage.alreadyDefault")
                        : t("agentsPage.setDefaultTitle")}
                    >
                      ${defaultId && selectedAgent.id === defaultId
                        ? t("agentsPage.default")
                        : t("agentsPage.setDefault")}
                    </button>
                  `
                : nothing}
              <button
                class="btn btn--sm agents-refresh-btn"
                ?disabled=${props.loading}
                @click=${props.onRefresh}
              >
                ${props.loading ? t("skillsPage.loading") : t("common.refresh")}
              </button>
            </div>
          </div>
          ${props.error
            ? html`<div class="callout danger" style="margin-top: 8px;">${props.error}</div>`
            : nothing}
          <div class="operations-panel__stats">
            <div class="operations-panel__stat">
              <span class="operations-panel__stat-label">${uiLiteral("Registry")}</span>
              <strong class="operations-panel__stat-value">${agents.length}</strong>
            </div>
            <div class="operations-panel__stat">
              <span class="operations-panel__stat-label">${uiLiteral("Default")}</span>
              <strong class="operations-panel__stat-value">${defaultId ?? t("common.na")}</strong>
            </div>
            <div class="operations-panel__stat">
              <span class="operations-panel__stat-label">${uiLiteral("Selection")}</span>
              <strong class="operations-panel__stat-value"
                >${selectedAgent
                  ? normalizeAgentLabel(selectedAgent)
                  : t("agentsPage.noAgents")}</strong
              >
            </div>
            <div class="operations-panel__stat">
              <span class="operations-panel__stat-label">${uiLiteral("Panel")}</span>
              <strong class="operations-panel__stat-value">${activePanel}</strong>
            </div>
            <div class="operations-panel__stat">
              <span class="operations-panel__stat-label">${uiLiteral("Runtime")}</span>
              <strong class="operations-panel__stat-value">${runtimeRunLabel}</strong>
            </div>
            <div class="operations-panel__stat">
              <span class="operations-panel__stat-label">${uiLiteral("Channels")}</span>
              <strong class="operations-panel__stat-value">${channelEntryCount ?? 0}</strong>
            </div>
          </div>
          <div class="control-context-strip">
            <div class="control-context-card">
              <span class="control-context-card__label">${uiLiteral("Runtime session")}</span>
              <strong class="control-context-card__value"
                >${props.runtimeSessionKey || uiLiteral("No session bound")}</strong
              >
              <span class="control-context-card__meta">
                ${props.runtimeSessionMatchesSelectedAgent
                  ? uiLiteral("Current runtime session matches selected agent")
                  : uiLiteral("Runtime session is outside the selected agent scope")}
              </span>
            </div>
            <div class="control-context-card">
              <span class="control-context-card__label">${uiLiteral("Inspect state")}</span>
              <strong class="control-context-card__value">${inspectState}</strong>
              <span class="control-context-card__meta">
                ${props.inspect.runId ?? uiLiteral("No inspect run pinned")}
              </span>
            </div>
            <div class="control-context-card">
              <span class="control-context-card__label">${uiLiteral("Config state")}</span>
              <strong class="control-context-card__value">${configState}</strong>
              <span class="control-context-card__meta">
                ${props.config.loading
                  ? uiLiteral("Loading agent configuration")
                  : uiLiteral("Model, tools, and skill policy flow through config")}
              </span>
            </div>
            <div class="control-context-card">
              <span class="control-context-card__label">${uiLiteral("Skills report")}</span>
              <strong class="control-context-card__value">${skillsState}</strong>
              <span class="control-context-card__meta">
                ${selectedSkillCount != null
                  ? `${selectedSkillCount} ${uiLiteral("skills visible for this agent")}`
                  : uiLiteral("Load the skills panel to inspect effective skill state")}
              </span>
            </div>
          </div>
        </section>
        <section class="agents-main">
          ${!selectedAgent
            ? html`
                <div class="card">
                  <div class="card-title">${t("agentsPage.selectTitle")}</div>
                  <div class="card-sub">${t("agentsPage.selectSubtitle")}</div>
                </div>
              `
            : html`
                ${renderAgentTabs(
                  activePanel,
                  (panel) => props.onSelectPanel(panel),
                  tabCounts,
                  uiMode,
                )}
                ${activePanel === "overview"
                  ? renderAgentOverview({
                      agent: selectedAgent,
                      basePath: props.basePath,
                      defaultId,
                      configForm: props.config.form,
                      agentFilesList: props.agentFiles.list,
                      agentIdentity: props.agentIdentityById[selectedAgent.id] ?? null,
                      agentIdentityError: props.agentIdentityError,
                      agentIdentityLoading: props.agentIdentityLoading,
                      configLoading: props.config.loading,
                      configSaving: props.config.saving,
                      configDirty: props.config.dirty,
                      modelCatalog: props.modelCatalog,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                      onModelChange: props.onModelChange,
                      onModelFallbacksChange: props.onModelFallbacksChange,
                      onSelectPanel: props.onSelectPanel,
                    })
                  : nothing}
                ${activePanel === "inspect"
                  ? renderAgentInspect({
                      loading: props.inspect.loading,
                      error: props.inspect.error,
                      snapshot: props.inspect.snapshot,
                      timelineFilter: props.inspect.timelineFilter,
                      selectedAgentId: selectedAgent.id,
                      currentRunId: props.runtimeRunId,
                      currentRunMatchesSelectedAgent: props.runtimeSessionMatchesSelectedAgent,
                      onRefresh: props.onInspectRefresh,
                      onInspectCurrentRun: props.onInspectCurrentRun,
                      onTimelineFilterChange: props.onInspectTimelineFilterChange,
                    })
                  : nothing}
                ${activePanel === "files"
                  ? renderAgentFiles({
                      agentId: selectedAgent.id,
                      agentFilesList: props.agentFiles.list,
                      agentFilesLoading: props.agentFiles.loading,
                      agentFilesError: props.agentFiles.error,
                      agentFileActive: props.agentFiles.active,
                      agentFileContents: props.agentFiles.contents,
                      agentFileDrafts: props.agentFiles.drafts,
                      agentFileSaving: props.agentFiles.saving,
                      onLoadFiles: props.onLoadFiles,
                      onSelectFile: props.onSelectFile,
                      onFileDraftChange: props.onFileDraftChange,
                      onFileReset: props.onFileReset,
                      onFileSave: props.onFileSave,
                    })
                  : nothing}
                ${activePanel === "tools"
                  ? renderAgentTools({
                      agentId: selectedAgent.id,
                      configForm: props.config.form,
                      configLoading: props.config.loading,
                      configSaving: props.config.saving,
                      configDirty: props.config.dirty,
                      toolsCatalogLoading: props.toolsCatalog.loading,
                      toolsCatalogError: props.toolsCatalog.error,
                      toolsCatalogResult: props.toolsCatalog.result,
                      toolsEffectiveLoading: props.toolsEffective.loading,
                      toolsEffectiveError: props.toolsEffective.error,
                      toolsEffectiveResult: props.toolsEffective.result,
                      runtimeSessionKey: props.runtimeSessionKey,
                      runtimeSessionMatchesSelectedAgent: props.runtimeSessionMatchesSelectedAgent,
                      onProfileChange: props.onToolsProfileChange,
                      onOverridesChange: props.onToolsOverridesChange,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                    })
                  : nothing}
                ${activePanel === "skills"
                  ? renderAgentSkills({
                      agentId: selectedAgent.id,
                      report: props.agentSkills.report,
                      loading: props.agentSkills.loading,
                      error: props.agentSkills.error,
                      activeAgentId: props.agentSkills.agentId,
                      configForm: props.config.form,
                      configLoading: props.config.loading,
                      configSaving: props.config.saving,
                      configDirty: props.config.dirty,
                      filter: props.agentSkills.filter,
                      onFilterChange: props.onSkillsFilterChange,
                      onRefresh: props.onSkillsRefresh,
                      onToggle: props.onAgentSkillToggle,
                      onClear: props.onAgentSkillsClear,
                      onDisableAll: props.onAgentSkillsDisableAll,
                      onConfigReload: props.onConfigReload,
                      onConfigSave: props.onConfigSave,
                    })
                  : nothing}
                ${activePanel === "channels"
                  ? renderAgentChannels({
                      context: buildAgentContext(
                        selectedAgent,
                        props.config.form,
                        props.agentFiles.list,
                        defaultId,
                        props.agentIdentityById[selectedAgent.id] ?? null,
                      ),
                      configForm: props.config.form,
                      snapshot: props.channels.snapshot,
                      loading: props.channels.loading,
                      error: props.channels.error,
                      lastSuccess: props.channels.lastSuccess,
                      onRefresh: props.onChannelsRefresh,
                      onSelectPanel: props.onSelectPanel,
                    })
                  : nothing}
                ${activePanel === "cron"
                  ? renderAgentCron({
                      context: buildAgentContext(
                        selectedAgent,
                        props.config.form,
                        props.agentFiles.list,
                        defaultId,
                        props.agentIdentityById[selectedAgent.id] ?? null,
                      ),
                      agentId: selectedAgent.id,
                      jobs: props.cron.jobs,
                      status: props.cron.status,
                      loading: props.cron.loading,
                      error: props.cron.error,
                      onRefresh: props.onCronRefresh,
                      onRunNow: props.onCronRunNow,
                      onSelectPanel: props.onSelectPanel,
                    })
                  : nothing}
              `}
        </section>
      </div>
    </section>
  `;
}

function renderAgentTabs(
  active: AgentsPanel,
  onSelect: (panel: AgentsPanel) => void,
  counts: Record<string, number | null>,
  uiMode: "simple" | "advanced",
) {
  const tabs: Array<{ id: AgentsPanel; label: string }> = [
    { id: "overview", label: t("tabs.overview") },
    { id: "skills", label: t("tabs.skills") },
    { id: "tools", label: t("agentsPage.tabs.tools") },
    { id: "files", label: t("agentsPage.tabs.files") },
    { id: "channels", label: t("tabs.channels") },
    { id: "cron", label: t("tabs.cron") },
    ...(uiMode === "advanced"
      ? [
          { id: "inspect", label: t("agentsPage.tabs.inspect") } satisfies {
            id: AgentsPanel;
            label: string;
          },
        ]
      : []),
  ];
  return html`
    <div class="agent-tabs">
      ${tabs.map(
        (tab) => html`
          <button
            class="agent-tab ${active === tab.id ? "active" : ""}"
            type="button"
            @click=${() => onSelect(tab.id)}
          >
            ${tab.label}${counts[tab.id] != null
              ? html`<span class="agent-tab-count">${counts[tab.id]}</span>`
              : nothing}
          </button>
        `,
      )}
    </div>
  `;
}
