import { html, nothing } from "lit";
import type {
  WorkflowDefinitionDiff,
  WorkflowExecutionView,
} from "../../../../src/workflows/types.js";
import type {
  WorkflowDetailSnapshot,
  WorkflowDiffSnapshot,
  WorkflowEditorDraft,
  WorkflowListEntry,
  WorkflowVersionsSnapshot,
} from "../controllers/workflows.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { uiLiteral } from "../ui-literal.ts";

export type WorkflowsProps = {
  connected: boolean;
  loading: boolean;
  error: string | null;
  detailLoading: boolean;
  detailError: string | null;
  runsLoading: boolean;
  runsError: string | null;
  statusLoading: boolean;
  statusError: string | null;
  workflows: WorkflowListEntry[];
  filterQuery: string;
  filterState: "all" | "enabled" | "disabled" | "deployed" | "approval";
  selectedWorkflowId: string | null;
  detail: WorkflowDetailSnapshot | null;
  runs: WorkflowExecutionView[];
  versionsLoading: boolean;
  versionsError: string | null;
  versions: WorkflowVersionsSnapshot | null;
  diffLoading: boolean;
  diffError: string | null;
  diffSnapshot: WorkflowDiffSnapshot | null;
  editorDraft: WorkflowEditorDraft | null;
  selectedExecutionId: string | null;
  selectedExecution: WorkflowExecutionView | null;
  resumeDraft: string;
  actionBusyKey: string | null;
  onRefresh: () => void;
  onFilterQueryChange: (value: string) => void;
  onFilterStateChange: (value: WorkflowsProps["filterState"]) => void;
  onSelectWorkflow: (workflowId: string) => void;
  onDeploy: (workflowId: string) => void;
  onRepublish: (workflowId: string) => void;
  onRun: (workflowId: string) => void;
  onToggleEnabled: (workflowId: string, enabled: boolean) => void;
  onSetArchived: (workflowId: string, archived: boolean) => void;
  onDeleteWorkflow: (workflowId: string) => void;
  onCompareVersion: (workflowId: string, specVersion: number) => void;
  onEditorChange: (patch: Partial<WorkflowEditorDraft>) => void;
  onResetEditor: () => void;
  onSaveEditor: (workflowId: string) => void;
  onRollbackVersion: (workflowId: string, specVersion: number, republish: boolean) => void;
  onSelectExecution: (executionId: string) => void;
  onRefreshExecution: (executionId: string) => void;
  onCancelExecution: (executionId: string) => void;
  onResumeDraftChange: (value: string) => void;
  onResumeExecution: (executionId: string, input: string) => void;
};

function formatWhen(ts?: number | null): string {
  if (!ts) {
    return uiLiteral("n/a");
  }
  return `${new Date(ts).toLocaleString()} · ${formatRelativeTimestamp(ts)}`;
}

function workflowStatusLabel(status?: string | null): string {
  if (!status) {
    return uiLiteral("unknown");
  }
  return uiLiteral(status);
}

function executorLabel(executor?: string | null): string {
  if (!executor) {
    return uiLiteral("n/a");
  }
  return uiLiteral(executor);
}

function stepKindLabel(kind?: string | null): string {
  if (!kind) {
    return uiLiteral("n/a");
  }
  return uiLiteral(kind);
}

function sourceLabel(source?: string | null): string {
  if (!source) {
    return uiLiteral("n/a");
  }
  return uiLiteral(source);
}

function deploymentLabel(detail: WorkflowDetailSnapshot | null): string {
  return uiLiteral(detail?.workflow.deploymentState === "deployed" ? "deployed" : "draft");
}

function isTerminalStatus(status?: string | null): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function isDangerStatus(status?: string | null): boolean {
  return status === "failed" || status === "cancelled";
}

function metric(label: string, value: string | number) {
  return html`
    <div style="display:grid; gap:4px;">
      <span class="label">${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function renderDiffFields(fields: Array<{ field: string; before?: unknown; after?: unknown }>) {
  if (!fields.length) {
    return html`<div class="muted">${uiLiteral("No changes detected.")}</div>`;
  }
  return html`
    <div style="display:grid; gap:8px;">
      ${fields.map(
        (field) => html`
          <div
            style="display:grid; gap:6px; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface);"
          >
            <strong>${field.field}</strong>
            <div class="muted">
              ${uiLiteral("Before")}:
              ${field.before === undefined ? "∅" : JSON.stringify(field.before)}
            </div>
            <div class="muted">
              ${uiLiteral("After")}:
              ${field.after === undefined ? "∅" : JSON.stringify(field.after)}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderWorkflowDiff(diff: WorkflowDefinitionDiff | null) {
  if (!diff) {
    return html`<div class="muted">${uiLiteral("No diff loaded yet.")}</div>`;
  }
  return html`
    <div style="display:grid; gap:12px;">
      <div
        style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:12px;"
      >
        ${metric(
          uiLiteral("Basic changes"),
          diff.summary.basicChanged ? uiLiteral("yes") : uiLiteral("no"),
        )}
        ${metric(
          uiLiteral("Policy changes"),
          diff.summary.policyChanged ? uiLiteral("yes") : uiLiteral("no"),
        )}
        ${metric(uiLiteral("Steps added"), diff.summary.stepsAdded)}
        ${metric(uiLiteral("Steps updated"), diff.summary.stepsUpdated)}
      </div>
      <details open>
        <summary><strong>${uiLiteral("Basic")}</strong></summary>
        <div style="margin-top:10px;">${renderDiffFields(diff.changes.basic)}</div>
      </details>
      <details>
        <summary><strong>${uiLiteral("Policy")}</strong></summary>
        <div style="margin-top:10px;">${renderDiffFields(diff.changes.policy)}</div>
      </details>
      <details>
        <summary><strong>${uiLiteral("Inputs")}</strong></summary>
        <div style="margin-top:10px;">${renderDiffFields(diff.changes.inputs)}</div>
      </details>
      <details>
        <summary><strong>${uiLiteral("Outputs")}</strong></summary>
        <div style="margin-top:10px;">${renderDiffFields(diff.changes.outputs)}</div>
      </details>
      <details>
        <summary><strong>${uiLiteral("Steps")}</strong></summary>
        <div style="margin-top:10px; display:grid; gap:10px;">
          ${diff.changes.steps.length
            ? diff.changes.steps.map(
                (step) => html`
                  <div
                    style="display:grid; gap:6px; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--surface);"
                  >
                    <div
                      style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;"
                    >
                      <strong>${step.stepId}</strong>
                      <span class="pill">${uiLiteral(step.change)}</span>
                    </div>
                    ${step.fields?.length
                      ? renderDiffFields(step.fields)
                      : html`<div class="muted">${uiLiteral("No extra details")}</div>`}
                  </div>
                `,
              )
            : html`<div class="muted">${uiLiteral("No changes detected.")}</div>`}
        </div>
      </details>
    </div>
  `;
}

function renderVersionsPanel(detail: WorkflowDetailSnapshot | null, props: WorkflowsProps) {
  if (!detail) {
    return html`<div class="muted">${uiLiteral("Select a workflow to inspect versions.")}</div>`;
  }
  const workflowId = detail.workflow.workflowId;
  if (props.versionsLoading) {
    return html`<div class="muted">${uiLiteral("Loading…")}</div>`;
  }
  if (props.versionsError) {
    return html`<div class="callout danger">${props.versionsError}</div>`;
  }
  const versions = props.versions;
  return html`
    <div style="display:grid; gap:12px;">
      <div
        style="display:grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr); gap:16px;"
      >
        <div style="display:grid; gap:10px;">
          <div class="card-title">${uiLiteral("Spec Versions")}</div>
          ${versions?.specVersions.length
            ? versions.specVersions.map(
                (snapshot) => html`
                  <div
                    style="display:grid; gap:8px; padding:12px 14px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface);"
                  >
                    <div
                      style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;"
                    >
                      <div style="display:grid; gap:4px;">
                        <strong>v${snapshot.specVersion}</strong>
                        <span class="muted"
                          >${snapshot.reason} · ${formatWhen(snapshot.savedAt)}</span
                        >
                      </div>
                      <div class="row" style="gap:8px; flex-wrap:wrap;">
                        <button
                          class="btn btn--sm"
                          @click=${() => props.onCompareVersion(workflowId, snapshot.specVersion)}
                        >
                          ${uiLiteral("Compare")}
                        </button>
                        <button
                          class="btn btn--sm"
                          ?disabled=${props.actionBusyKey ===
                          `rollback:${workflowId}:${snapshot.specVersion}`}
                          @click=${() =>
                            props.onRollbackVersion(workflowId, snapshot.specVersion, false)}
                        >
                          ${uiLiteral("Rollback")}
                        </button>
                        <button
                          class="btn btn--sm"
                          ?disabled=${props.actionBusyKey ===
                          `rollback-republish:${workflowId}:${snapshot.specVersion}`}
                          @click=${() =>
                            props.onRollbackVersion(workflowId, snapshot.specVersion, true)}
                        >
                          ${uiLiteral("Rollback + Republish")}
                        </button>
                      </div>
                    </div>
                    <div class="muted">${snapshot.name} · ${snapshot.topology || "linear_v1"}</div>
                  </div>
                `,
              )
            : html`<div class="muted">${uiLiteral("No versions recorded yet.")}</div>`}
        </div>
        <div style="display:grid; gap:10px;">
          <div class="card-title">${uiLiteral("Deployments")}</div>
          ${versions?.deployments.length
            ? versions.deployments.map(
                (deployment) => html`
                  <div
                    style="display:grid; gap:6px; padding:12px 14px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface);"
                  >
                    <strong>deploy v${deployment.deploymentVersion}</strong>
                    <div class="muted">spec v${deployment.specVersion}</div>
                    <div class="muted">${formatWhen(deployment.publishedAt)}</div>
                    ${deployment.summary
                      ? html`<div class="muted">${deployment.summary}</div>`
                      : nothing}
                  </div>
                `,
              )
            : html`<div class="muted">${uiLiteral("No deployments recorded yet.")}</div>`}
        </div>
      </div>
    </div>
  `;
}

function renderEditorPanel(detail: WorkflowDetailSnapshot | null, props: WorkflowsProps) {
  if (!detail || !props.editorDraft) {
    return html`<div class="muted">
      ${uiLiteral("Select a workflow to edit the source spec.")}
    </div>`;
  }
  const draft = props.editorDraft;
  const workflowId = detail.workflow.workflowId;
  const saveBusy = props.actionBusyKey === `update:${workflowId}`;
  const republishBusy = props.actionBusyKey === `republish:${workflowId}`;
  return html`
    <div style="display:grid; gap:14px;">
      <div
        style="display:grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap:16px;"
      >
        <div style="display:grid; gap:12px;">
          <label style="display:grid; gap:6px;">
            <span class="label">${uiLiteral("Name")}</span>
            <input
              class="input"
              .value=${draft.name}
              @input=${(e: Event) =>
                props.onEditorChange({ name: (e.currentTarget as HTMLInputElement).value })}
            />
          </label>
          <label style="display:grid; gap:6px;">
            <span class="label">${uiLiteral("Goal")}</span>
            <textarea
              class="input"
              rows="3"
              .value=${draft.goal}
              @input=${(e: Event) =>
                props.onEditorChange({ goal: (e.currentTarget as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
          <label style="display:grid; gap:6px;">
            <span class="label">${uiLiteral("Description")}</span>
            <textarea
              class="input"
              rows="4"
              .value=${draft.description}
              @input=${(e: Event) =>
                props.onEditorChange({
                  description: (e.currentTarget as HTMLTextAreaElement).value,
                })}
            ></textarea>
          </label>
          <label style="display:grid; gap:6px;">
            <span class="label">${uiLiteral("Tags")}</span>
            <input
              class="input"
              .value=${draft.tags}
              @input=${(e: Event) =>
                props.onEditorChange({ tags: (e.currentTarget as HTMLInputElement).value })}
            />
          </label>
          <label style="display:grid; gap:6px;">
            <span class="label">${uiLiteral("Topology")}</span>
            <select
              class="input"
              .value=${draft.topology}
              @change=${(e: Event) =>
                props.onEditorChange({ topology: (e.currentTarget as HTMLSelectElement).value })}
            >
              <option value="linear_v1">linear_v1</option>
              <option value="branch_v2">branch_v2</option>
            </select>
          </label>
          <label class="row" style="gap:10px;">
            <input
              type="checkbox"
              .checked=${draft.safeForAutoRun}
              @change=${(e: Event) =>
                props.onEditorChange({
                  safeForAutoRun: (e.currentTarget as HTMLInputElement).checked,
                })}
            />
            <span>${uiLiteral("Auto-run safe")}</span>
          </label>
          <label class="row" style="gap:10px;">
            <input
              type="checkbox"
              .checked=${draft.requiresApproval}
              @change=${(e: Event) =>
                props.onEditorChange({
                  requiresApproval: (e.currentTarget as HTMLInputElement).checked,
                })}
            />
            <span>${uiLiteral("Approval required")}</span>
          </label>
        </div>
        <div style="display:grid; gap:12px;">
          <label style="display:grid; gap:6px;">
            <span class="label">${uiLiteral("Inputs JSON")}</span>
            <textarea
              class="input"
              rows="6"
              .value=${draft.inputsJson}
              @input=${(e: Event) =>
                props.onEditorChange({
                  inputsJson: (e.currentTarget as HTMLTextAreaElement).value,
                })}
            ></textarea>
          </label>
          <label style="display:grid; gap:6px;">
            <span class="label">${uiLiteral("Outputs JSON")}</span>
            <textarea
              class="input"
              rows="6"
              .value=${draft.outputsJson}
              @input=${(e: Event) =>
                props.onEditorChange({
                  outputsJson: (e.currentTarget as HTMLTextAreaElement).value,
                })}
            ></textarea>
          </label>
          <label style="display:grid; gap:6px;">
            <span class="label">${uiLiteral("Steps JSON")}</span>
            <textarea
              class="input"
              rows="14"
              .value=${draft.stepsJson}
              @input=${(e: Event) =>
                props.onEditorChange({ stepsJson: (e.currentTarget as HTMLTextAreaElement).value })}
            ></textarea>
          </label>
        </div>
      </div>
      <div class="row" style="gap:8px; flex-wrap:wrap;">
        <button
          class="btn btn--sm"
          ?disabled=${saveBusy}
          @click=${() => props.onSaveEditor(workflowId)}
        >
          ${saveBusy ? uiLiteral("Saving…") : uiLiteral("Save spec")}
        </button>
        <button class="btn btn--sm" @click=${props.onResetEditor}>
          ${uiLiteral("Reset editor")}
        </button>
        <button
          class="btn btn--sm"
          ?disabled=${republishBusy || detail.workflow.deploymentVersion <= 0}
          @click=${() => props.onRepublish(workflowId)}
        >
          ${republishBusy ? uiLiteral("Republishing…") : uiLiteral("Republish")}
        </button>
      </div>
    </div>
  `;
}

function renderWorkflowListEntry(workflow: WorkflowListEntry, props: WorkflowsProps) {
  const selected = workflow.workflowId === props.selectedWorkflowId;
  const recentExecution = workflow.recentExecution;
  return html`
    <button
      class="btn"
      style="display:grid; gap:8px; width:100%; text-align:left; justify-items:start; padding:14px;"
      @click=${() => props.onSelectWorkflow(workflow.workflowId)}
    >
      <div
        style="display:flex; align-items:flex-start; justify-content:space-between; width:100%; gap:12px;"
      >
        <div style="display:grid; gap:4px;">
          <strong>${workflow.name}</strong>
          <span class="muted">${workflow.description || workflow.workflowId}</span>
        </div>
        <span class="pill ${selected ? "danger" : ""}"
          >${selected ? uiLiteral("selected") : workflow.scope}</span
        >
      </div>
      <div style="display:flex; flex-wrap:wrap; gap:8px;">
        <span class="pill">${workflow.enabled ? uiLiteral("enabled") : uiLiteral("disabled")}</span>
        <span class="pill"
          >${workflow.deploymentState === "deployed"
            ? uiLiteral("deployed")
            : uiLiteral("draft")}</span
        >
        ${workflow.archivedAt
          ? html`<span class="pill danger">${uiLiteral("archived")}</span>`
          : nothing}
        <span class="pill">${workflow.runCount} ${uiLiteral("runs")}</span>
      </div>
      ${recentExecution
        ? html`
            <div class="muted">
              ${uiLiteral("Recent run")}: ${workflowStatusLabel(recentExecution.status)} ·
              ${formatWhen(recentExecution.updatedAt)}
            </div>
          `
        : html`<div class="muted">${uiLiteral("No executions recorded yet.")}</div>`}
    </button>
  `;
}

function renderExecutionRow(execution: WorkflowExecutionView, props: WorkflowsProps) {
  const selected = execution.executionId === props.selectedExecutionId;
  return html`
    <button
      class="btn"
      style="display:grid; gap:8px; width:100%; text-align:left; justify-items:start; padding:12px;"
      @click=${() => props.onSelectExecution(execution.executionId)}
    >
      <div
        style="display:flex; align-items:center; justify-content:space-between; width:100%; gap:12px;"
      >
        <div style="display:grid; gap:4px;">
          <strong>${execution.executionId}</strong>
          <span class="muted"
            >${uiLiteral("Current step")}: ${execution.currentStepId || uiLiteral("n/a")}</span
          >
        </div>
        <span class="pill ${selected || isDangerStatus(execution.status) ? "danger" : ""}"
          >${workflowStatusLabel(execution.status)}</span
        >
      </div>
      <div class="muted">
        ${uiLiteral("Executor")}: ${executorLabel(execution.currentExecutor)} ·
        ${uiLiteral("Source")}: ${sourceLabel(execution.source)} ·
        ${formatWhen(execution.updatedAt)}
      </div>
    </button>
  `;
}

function renderExecutionDetail(execution: WorkflowExecutionView | null, props: WorkflowsProps) {
  if (!execution) {
    return html`<div class="muted">
      ${uiLiteral("Select a run to inspect timeline and state.")}
    </div>`;
  }
  const canCancel = !isTerminalStatus(execution.status);
  const statusBusyKey = `cancel:${execution.executionId}`;
  const refreshBusy = props.statusLoading;
  const cancelBusy = props.actionBusyKey === statusBusyKey;
  const resumeBusy = props.actionBusyKey === `resume:${execution.executionId}`;
  const waitingHint =
    execution.status === "waiting_input"
      ? uiLiteral("Waiting for your input or approval before this workflow can continue.")
      : execution.status === "waiting_external"
        ? uiLiteral("Waiting for an external event before this workflow can continue.")
        : execution.currentExecutor === "crawclaw_agent" && execution.status === "running"
          ? uiLiteral("CrawClaw agent is executing the current workflow step.")
          : null;
  const canResume = execution.waiting?.canResume === true;
  return html`
    <div style="display:grid; gap:14px;">
      <div
        style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;"
      >
        <div style="display:grid; gap:6px;">
          <div class="card-title">${uiLiteral("Execution Detail")}</div>
          <div class="card-sub">${execution.executionId}</div>
        </div>
        <div class="row" style="gap:8px; flex-wrap:wrap;">
          <button
            class="btn btn--sm"
            ?disabled=${refreshBusy}
            @click=${() => props.onRefreshExecution(execution.executionId)}
          >
            ${refreshBusy ? uiLiteral("Refreshing…") : uiLiteral("Refresh status")}
          </button>
          <button
            class="btn btn--sm"
            ?disabled=${!canCancel || cancelBusy}
            @click=${() => props.onCancelExecution(execution.executionId)}
          >
            ${cancelBusy ? uiLiteral("Cancelling…") : uiLiteral("Cancel run")}
          </button>
        </div>
      </div>

      <div
        style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px;"
      >
        ${metric(uiLiteral("Status"), workflowStatusLabel(execution.status))}
        ${metric(uiLiteral("Executor"), executorLabel(execution.currentExecutor))}
        ${metric(uiLiteral("Current step"), execution.currentStepId || uiLiteral("n/a"))}
        ${metric(uiLiteral("Source"), sourceLabel(execution.source))}
      </div>

      <div
        style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px;"
      >
        ${metric(uiLiteral("Started"), formatWhen(execution.startedAt))}
        ${metric(uiLiteral("Updated"), formatWhen(execution.updatedAt))}
        ${metric(uiLiteral("Ended"), formatWhen(execution.endedAt))}
      </div>

      ${props.statusError ? html`<div class="callout danger">${props.statusError}</div>` : nothing}
      ${waitingHint ? html`<div class="callout">${waitingHint}</div>` : nothing}
      ${execution.waiting
        ? html`
            <div style="display:grid; gap:8px;">
              <div class="card-title">${uiLiteral("Resume workflow")}</div>
              ${execution.waiting.prompt
                ? html`<div class="muted">${execution.waiting.prompt}</div>`
                : nothing}
              ${execution.waiting.resumeUrl
                ? html`<div class="muted">${uiLiteral("Resume URL available")}</div>`
                : html`<div class="muted">
                    ${uiLiteral("Resume is not available yet for this execution.")}
                  </div>`}
              <textarea
                class="input"
                rows="3"
                .value=${props.resumeDraft}
                placeholder=${uiLiteral("Paste plain text or JSON to resume a waiting workflow.")}
                ?disabled=${!canResume || resumeBusy}
                @input=${(event: Event) =>
                  props.onResumeDraftChange((event.currentTarget as HTMLTextAreaElement).value)}
              ></textarea>
              <div class="row" style="gap:8px; flex-wrap:wrap;">
                <button
                  class="btn btn--sm"
                  ?disabled=${!canResume || resumeBusy}
                  @click=${() => props.onResumeExecution(execution.executionId, props.resumeDraft)}
                >
                  ${resumeBusy ? uiLiteral("Resuming…") : uiLiteral("Resume workflow")}
                </button>
              </div>
            </div>
          `
        : nothing}

      <div style="display:grid; gap:10px;">
        <div class="card-title">${uiLiteral("Step Timeline")}</div>
        ${execution.steps?.length
          ? execution.steps.map(
              (step) => html`
                <div
                  style="display:grid; gap:8px; padding:12px 14px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--panel);"
                >
                  <div
                    style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"
                  >
                    <div style="display:grid; gap:4px;">
                      <strong>${step.title || step.stepId}</strong>
                      <span class="muted">${step.stepId}</span>
                    </div>
                    <span class="pill ${isDangerStatus(step.status) ? "danger" : ""}"
                      >${workflowStatusLabel(step.status)}</span
                    >
                  </div>
                  <div class="muted">
                    ${uiLiteral("Kind")}: ${stepKindLabel(step.kind)} · ${uiLiteral("Executor")}:
                    ${executorLabel(step.executor)} · ${uiLiteral("Updated")}:
                    ${formatWhen(step.updatedAt)}
                  </div>
                  <div class="muted">
                    ${uiLiteral("Path")}: ${step.path || "main"} · ${uiLiteral("Branch group")}:
                    ${step.branchGroup || uiLiteral("n/a")} · ${uiLiteral("Activation")}:
                    ${uiLiteral(step.activationMode || "sequential")}
                  </div>
                  ${step.parallelFailurePolicy ||
                  step.parallelJoinPolicy ||
                  typeof step.maxActiveBranches === "number" ||
                  step.retryOnFail
                    ? html`
                        <div class="muted">
                          ${uiLiteral("Parallel policy")}:
                          ${step.parallelFailurePolicy || uiLiteral("n/a")} · ${uiLiteral("Join")}:
                          ${step.parallelJoinPolicy || uiLiteral("n/a")} ·
                          ${uiLiteral("Max active branches")}:
                          ${step.maxActiveBranches ?? uiLiteral("n/a")} · ${uiLiteral("Retry")}:
                          ${step.retryOnFail
                            ? `${uiLiteral("yes")} (${step.maxTries ?? 3}/${step.waitBetweenTriesMs ?? 1000}ms)`
                            : uiLiteral("no")}
                        </div>
                      `
                    : nothing}
                  ${step.compensationMode
                    ? html`
                        <div class="muted">
                          ${uiLiteral("Compensation")}: ${step.compensationMode} ·
                          ${uiLiteral("Compensation status")}:
                          ${step.compensationStatus || uiLiteral("n/a")}
                        </div>
                      `
                    : nothing}
                  ${step.compensationSummary
                    ? html` <div class="muted">${step.compensationSummary}</div> `
                    : nothing}
                  ${step.compensationError
                    ? html`<div class="callout danger">${step.compensationError}</div>`
                    : nothing}
                  ${step.summary ? html`<div>${step.summary}</div>` : nothing}
                  ${step.skippedReason
                    ? html`
                        <div class="muted">
                          ${uiLiteral("Skipped reason")}: ${step.skippedReason}
                        </div>
                      `
                    : nothing}
                  ${step.error ? html`<div class="callout danger">${step.error}</div>` : nothing}
                </div>
              `,
            )
          : html`<div class="muted">${uiLiteral("No step timeline recorded yet.")}</div>`}
      </div>

      <div style="display:grid; gap:10px;">
        <div class="card-title">${uiLiteral("Run Logs")}</div>
        ${execution.events?.length
          ? html`
              <div style="display:grid; gap:8px;">
                ${execution.events.map(
                  (event) => html`
                    <details
                      style="border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface); padding:10px 12px;"
                    >
                      <summary
                        style="cursor:pointer; display:flex; gap:10px; align-items:center; flex-wrap:wrap;"
                      >
                        <strong>${event.message}</strong>
                        <span class="pill ${event.level === "error" ? "danger" : ""}"
                          >${event.level}</span
                        >
                        <span class="muted">${formatWhen(event.at)}</span>
                      </summary>
                      <div style="display:grid; gap:8px; margin-top:10px;">
                        <div class="muted">${uiLiteral("Type")}: ${event.type}</div>
                        ${event.details
                          ? html`
                              <pre
                                style="margin:0; white-space:pre-wrap; word-break:break-word; padding:10px 12px; border:1px solid var(--border); border-radius:var(--radius-md); background:var(--panel);"
                              >
${JSON.stringify(event.details, null, 2)}</pre
                              >
                            `
                          : html`<div class="muted">${uiLiteral("No extra details")}</div>`}
                      </div>
                    </details>
                  `,
                )}
              </div>
            `
          : html`<div class="muted">${uiLiteral("No run logs recorded yet.")}</div>`}
      </div>
    </div>
  `;
}

export function renderWorkflows(props: WorkflowsProps) {
  const detail = props.detail;
  const selectedWorkflowId = detail?.workflow.workflowId ?? props.selectedWorkflowId;
  const isEnabled = detail?.workflow.enabled ?? false;
  const isDeployed = detail?.workflow.deploymentState === "deployed";
  const isArchived = Boolean(detail?.workflow.archivedAt);
  const workflowRef = selectedWorkflowId ?? null;
  const normalizedQuery = props.filterQuery.trim().toLowerCase();
  const filteredWorkflows = props.workflows
    .filter((workflow) => {
      const matchesQuery =
        !normalizedQuery ||
        workflow.name.toLowerCase().includes(normalizedQuery) ||
        workflow.workflowId.toLowerCase().includes(normalizedQuery) ||
        workflow.description?.toLowerCase().includes(normalizedQuery) ||
        workflow.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
      if (!matchesQuery) {
        return false;
      }
      switch (props.filterState) {
        case "enabled":
          return workflow.enabled;
        case "disabled":
          return !workflow.enabled;
        case "deployed":
          return workflow.deploymentState === "deployed";
        case "approval":
          return workflow.requiresApproval;
        default:
          return true;
      }
    })
    .toSorted((left, right) => {
      const archivedDelta = Number(Boolean(left.archivedAt)) - Number(Boolean(right.archivedAt));
      if (archivedDelta !== 0) {
        return archivedDelta;
      }
      return 0;
    });

  return html`
    <section class="card">
      <div class="row" style="justify-content:space-between; margin-bottom: 12px;">
        <div>
          <div class="card-title">${uiLiteral("Workflows")}</div>
          <div class="card-sub">
            ${uiLiteral("Workflow registry, deployment, and execution timeline.")}
          </div>
        </div>
        <button
          class="btn"
          ?disabled=${props.loading || !props.connected}
          @click=${props.onRefresh}
        >
          ${props.loading ? uiLiteral("Loading…") : uiLiteral("Refresh")}
        </button>
      </div>

      ${props.error
        ? html`<div class="callout danger" style="margin-bottom: 12px;">${props.error}</div>`
        : nothing}
      ${!props.connected
        ? html`<div class="muted">${uiLiteral("Connect to the gateway to load workflows.")}</div>`
        : nothing}

      <div
        style="display:grid; grid-template-columns: minmax(280px, 360px) minmax(0, 1fr); gap:16px; align-items:start;"
      >
        <div style="display:grid; gap:12px;">
          <section
            style="display:grid; gap:12px; padding:12px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--panel);"
          >
            <div style="display:grid; gap:10px;">
              <div class="card-title">${uiLiteral("Registry")}</div>
              <input
                class="input"
                .value=${props.filterQuery}
                placeholder=${uiLiteral("Search workflows")}
                @input=${(event: Event) =>
                  props.onFilterQueryChange((event.currentTarget as HTMLInputElement).value)}
              />
              <select
                class="input"
                .value=${props.filterState}
                @change=${(event: Event) =>
                  props.onFilterStateChange(
                    (event.currentTarget as HTMLSelectElement)
                      .value as WorkflowsProps["filterState"],
                  )}
              >
                <option value="all">${uiLiteral("All workflows")}</option>
                <option value="enabled">${uiLiteral("Enabled only")}</option>
                <option value="disabled">${uiLiteral("Disabled only")}</option>
                <option value="deployed">${uiLiteral("Deployed only")}</option>
                <option value="approval">${uiLiteral("Approval required only")}</option>
              </select>
            </div>
            ${filteredWorkflows.length
              ? filteredWorkflows.map((workflow) => renderWorkflowListEntry(workflow, props))
              : html`<div class="muted">${uiLiteral("No workflows have been saved yet.")}</div>`}
          </section>
        </div>

        <div style="display:grid; gap:16px;">
          <section
            style="display:grid; gap:14px; padding:16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--panel);"
          >
            ${detail
              ? html`
                  <div
                    style="display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap;"
                  >
                    <div style="display:grid; gap:6px;">
                      <div class="card-title">${detail.workflow.name}</div>
                      <div class="card-sub">${detail.workflow.description || detail.spec.goal}</div>
                    </div>
                    <div class="row" style="gap:8px; flex-wrap:wrap;">
                      <button
                        class="btn btn--sm"
                        ?disabled=${!workflowRef ||
                        props.actionBusyKey ===
                          `${isDeployed ? "republish" : "deploy"}:${workflowRef}`}
                        @click=${() =>
                          workflowRef &&
                          (isDeployed
                            ? props.onRepublish(workflowRef)
                            : props.onDeploy(workflowRef))}
                      >
                        ${props.actionBusyKey ===
                        `${isDeployed ? "republish" : "deploy"}:${workflowRef}`
                          ? isDeployed
                            ? uiLiteral("Republishing…")
                            : uiLiteral("Deploying…")
                          : isDeployed
                            ? uiLiteral("Republish")
                            : uiLiteral("Deploy")}
                      </button>
                      <button
                        class="btn btn--sm"
                        ?disabled=${!workflowRef ||
                        !isDeployed ||
                        props.actionBusyKey === `run:${workflowRef}`}
                        @click=${() => workflowRef && props.onRun(workflowRef)}
                      >
                        ${props.actionBusyKey === `run:${workflowRef}`
                          ? uiLiteral("Running…")
                          : uiLiteral("Run")}
                      </button>
                      <button
                        class="btn btn--sm"
                        ?disabled=${!workflowRef ||
                        props.actionBusyKey ===
                          `${isEnabled ? "disable" : "enable"}:${workflowRef}`}
                        @click=${() =>
                          workflowRef && props.onToggleEnabled(workflowRef, !isEnabled)}
                      >
                        ${props.actionBusyKey ===
                        `${isEnabled ? "disable" : "enable"}:${workflowRef}`
                          ? uiLiteral("Saving…")
                          : isEnabled
                            ? uiLiteral("Disable")
                            : uiLiteral("Enable")}
                      </button>
                      <button
                        class="btn btn--sm"
                        ?disabled=${!workflowRef ||
                        props.actionBusyKey ===
                          `${isArchived ? "unarchive" : "archive"}:${workflowRef}`}
                        @click=${() => workflowRef && props.onSetArchived(workflowRef, !isArchived)}
                      >
                        ${props.actionBusyKey ===
                        `${isArchived ? "unarchive" : "archive"}:${workflowRef}`
                          ? uiLiteral("Saving…")
                          : isArchived
                            ? uiLiteral("Unarchive")
                            : uiLiteral("Archive")}
                      </button>
                      <button
                        class="btn btn--sm"
                        ?disabled=${!workflowRef || props.actionBusyKey === `delete:${workflowRef}`}
                        @click=${() => workflowRef && props.onDeleteWorkflow(workflowRef)}
                      >
                        ${props.actionBusyKey === `delete:${workflowRef}`
                          ? uiLiteral("Deleting…")
                          : uiLiteral("Delete")}
                      </button>
                    </div>
                  </div>

                  <div style="display:flex; flex-wrap:wrap; gap:8px;">
                    <span class="pill">${deploymentLabel(detail)}</span>
                    <span class="pill"
                      >${isEnabled ? uiLiteral("enabled") : uiLiteral("disabled")}</span
                    >
                    ${isArchived
                      ? html`<span class="pill danger">${uiLiteral("archived")}</span>`
                      : nothing}
                    <span class="pill">${detail.workflow.scope}</span>
                    <span class="pill">spec v${detail.workflow.specVersion}</span>
                    <span class="pill">deploy v${detail.workflow.deploymentVersion}</span>
                    ${detail.workflow.requiresApproval
                      ? html`<span class="pill">${uiLiteral("Approval required")}</span>`
                      : nothing}
                    ${detail.workflow.safeForAutoRun
                      ? html`<span class="pill">${uiLiteral("Auto-run safe")}</span>`
                      : nothing}
                  </div>

                  <div
                    style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px;"
                  >
                    ${metric(uiLiteral("Inputs"), detail.spec.inputs.length)}
                    ${metric(uiLiteral("Outputs"), detail.spec.outputs.length)}
                    ${metric(uiLiteral("Steps"), detail.spec.steps.length)}
                    ${metric(uiLiteral("Last run"), formatWhen(detail.workflow.lastRunAt))}
                    ${metric(uiLiteral("Spec version"), detail.workflow.specVersion)}
                    ${metric(uiLiteral("Deployment version"), detail.workflow.deploymentVersion)}
                  </div>

                  <div style="display:grid; gap:8px;">
                    <div class="label">${uiLiteral("Tags")}</div>
                    <div style="display:flex; flex-wrap:wrap; gap:8px;">
                      ${detail.workflow.tags.length
                        ? detail.workflow.tags.map((tag) => html`<span class="pill">${tag}</span>`)
                        : html`<span class="muted">${uiLiteral("No tags")}</span>`}
                    </div>
                  </div>

                  <div style="display:grid; gap:8px;">
                    <div class="label">${uiLiteral("Store paths")}</div>
                    <div class="muted">${uiLiteral("Spec path")}: ${detail.specPath}</div>
                    <div class="muted">${uiLiteral("Store root")}: ${detail.storeRoot}</div>
                    ${detail.workflow.n8nWorkflowId
                      ? html`<div class="muted">
                          n8n workflow: ${detail.workflow.n8nWorkflowId}
                        </div>`
                      : nothing}
                  </div>

                  <div style="display:grid; gap:10px;">
                    <div class="card-title">${uiLiteral("Workflow Steps")}</div>
                    ${detail.spec.steps.length
                      ? detail.spec.steps.map(
                          (step, index) => html`
                            <div
                              style="display:grid; gap:6px; padding:12px 14px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--surface);"
                            >
                              <div
                                style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px;"
                              >
                                <div style="display:grid; gap:4px;">
                                  <strong>${index + 1}. ${step.title || step.id}</strong>
                                  <span class="muted">${step.id}</span>
                                </div>
                                <span class="pill">${stepKindLabel(step.kind)}</span>
                              </div>
                              ${step.goal ? html`<div>${step.goal}</div>` : nothing}
                              <div class="muted">
                                ${uiLiteral("Path")}: ${step.path || "main"} ·
                                ${uiLiteral("Branch group")}:
                                ${step.branchGroup || uiLiteral("n/a")} ·
                                ${uiLiteral("Activation")}:
                                ${uiLiteral(step.activation?.mode || "sequential")}
                              </div>
                              ${step.activation?.parallel &&
                              (step.activation.parallel.failurePolicy ||
                                step.activation.parallel.joinPolicy ||
                                typeof step.activation.parallel.maxActiveBranches === "number" ||
                                step.activation.parallel.retryOnFail)
                                ? html`<div class="muted">
                                    ${uiLiteral("Parallel policy")}:
                                    ${step.activation.parallel.failurePolicy || uiLiteral("n/a")} ·
                                    ${uiLiteral("Join")}:
                                    ${step.activation.parallel.joinPolicy || uiLiteral("n/a")} ·
                                    ${uiLiteral("Max active branches")}:
                                    ${step.activation.parallel.maxActiveBranches ??
                                    uiLiteral("n/a")}
                                    · ${uiLiteral("Retry")}:
                                    ${step.activation.parallel.retryOnFail
                                      ? `${uiLiteral("yes")} (${step.activation.parallel.maxTries ?? 3}/${step.activation.parallel.waitBetweenTriesMs ?? 1000}ms)`
                                      : uiLiteral("no")}
                                  </div>`
                                : nothing}
                              ${step.compensation
                                ? html`<div class="muted">
                                    ${uiLiteral("Compensation")}:
                                    ${step.compensation.mode || uiLiteral("n/a")}
                                  </div>`
                                : nothing}
                              ${step.service
                                ? html`<div class="muted">
                                    ${uiLiteral("Service")}: ${step.service}
                                  </div>`
                                : nothing}
                              ${step.prompt
                                ? html`<div class="muted">
                                    ${uiLiteral("Prompt")}: ${step.prompt}
                                  </div>`
                                : nothing}
                            </div>
                          `,
                        )
                      : html`<div class="muted">${uiLiteral("No workflow steps recorded.")}</div>`}
                  </div>
                `
              : html`<div class="muted">
                  ${uiLiteral("Select a workflow to inspect deployment and runs.")}
                </div>`}
            ${props.detailError
              ? html`<div class="callout danger">${props.detailError}</div>`
              : nothing}
          </section>

          <section
            style="display:grid; gap:14px; padding:16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--panel);"
          >
            <div
              style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap;"
            >
              <div>
                <div class="card-title">${uiLiteral("Version Rail")}</div>
                <div class="card-sub">
                  ${uiLiteral(
                    "Track spec history and deployment lineage before you change anything.",
                  )}
                </div>
              </div>
            </div>
            ${renderVersionsPanel(detail, props)}
          </section>

          <section
            style="display:grid; gap:14px; padding:16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--panel);"
          >
            <div>
              <div class="card-title">${uiLiteral("Change Summary")}</div>
              <div class="card-sub">
                ${props.diffSnapshot
                  ? html`${uiLiteral("Comparing spec")} v${props.diffSnapshot.fromSpecVersion} →
                    v${props.diffSnapshot.toSpecVersion}`
                  : uiLiteral(
                      "Inspect what changed between the current spec and the selected baseline.",
                    )}
              </div>
            </div>
            ${props.diffLoading
              ? html`<div class="muted">${uiLiteral("Loading…")}</div>`
              : props.diffError
                ? html`<div class="callout danger">${props.diffError}</div>`
                : renderWorkflowDiff(props.diffSnapshot?.diff ?? null)}
          </section>

          <section
            style="display:grid; gap:14px; padding:16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--panel);"
          >
            <div>
              <div class="card-title">${uiLiteral("Spec Workbench")}</div>
              <div class="card-sub">
                ${uiLiteral(
                  "Edit the source spec here, then republish to refresh the compiled n8n workflow.",
                )}
              </div>
            </div>
            ${renderEditorPanel(detail, props)}
          </section>

          <section
            style="display:grid; gap:14px; padding:16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--panel);"
          >
            <div class="card-title">${uiLiteral("Recent Runs")}</div>
            ${props.runsError
              ? html`<div class="callout danger">${props.runsError}</div>`
              : nothing}
            ${props.runsLoading
              ? html`<div class="muted">${uiLiteral("Loading…")}</div>`
              : props.runs.length
                ? html`
                    <div style="display:grid; gap:10px;">
                      ${props.runs.map((execution) => renderExecutionRow(execution, props))}
                    </div>
                  `
                : html`<div class="muted">${uiLiteral("No executions recorded yet.")}</div>`}
          </section>

          <section
            style="display:grid; gap:14px; padding:16px; border:1px solid var(--border); border-radius:var(--radius-lg); background:var(--panel);"
          >
            ${renderExecutionDetail(props.selectedExecution, props)}
          </section>
        </div>
      </div>
    </section>
  `;
}
