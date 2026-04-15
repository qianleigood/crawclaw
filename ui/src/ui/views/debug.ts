import { html, nothing } from "lit";
import type { EventLogEntry } from "../app-events.ts";
import { formatEventPayload } from "../presenter.ts";
import { uiLiteral } from "../ui-literal.ts";

export type DebugProps = {
  loading: boolean;
  status: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  models: unknown[];
  heartbeat: unknown;
  eventLog: EventLogEntry[];
  methods: string[];
  callMethod: string;
  callParams: string;
  callResult: string | null;
  callError: string | null;
  onCallMethodChange: (next: string) => void;
  onCallParamsChange: (next: string) => void;
  onRefresh: () => void;
  onCall: () => void;
};

export function renderDebug(props: DebugProps) {
  const securityAudit =
    props.status && typeof props.status === "object"
      ? (props.status as { securityAudit?: { summary?: Record<string, number> } }).securityAudit
      : null;
  const securitySummary = securityAudit?.summary ?? null;
  const critical = securitySummary?.critical ?? 0;
  const warn = securitySummary?.warn ?? 0;
  const info = securitySummary?.info ?? 0;
  const securityTone = critical > 0 ? "danger" : warn > 0 ? "warn" : "success";
  const securityLabel =
    critical > 0
      ? `${critical} ${uiLiteral("critical")}`
      : warn > 0
        ? `${warn} ${uiLiteral("warnings")}`
        : uiLiteral("No critical issues");

  return html`
    <section class="grid">
      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">${uiLiteral("Snapshots")}</div>
            <div class="card-sub">${uiLiteral("Status, health, and heartbeat data.")}</div>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? uiLiteral("Refreshing…") : uiLiteral("Refresh")}
          </button>
        </div>
        <div class="stack" style="margin-top: 12px;">
          <div>
            <div class="muted">${uiLiteral("Status")}</div>
            ${securitySummary
              ? html`<div class="callout ${securityTone}" style="margin-top: 8px;">
                  ${uiLiteral("Security audit")}: ${securityLabel}${info > 0 ? ` · ${info} ${uiLiteral("info")}` : ""}. ${uiLiteral("Run")} <span class="mono">crawclaw security audit --deep</span> ${uiLiteral("for details.")}
                </div>`
              : nothing}
            <pre class="code-block">${JSON.stringify(props.status ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">${uiLiteral("Health")}</div>
            <pre class="code-block">${JSON.stringify(props.health ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">${uiLiteral("Last heartbeat")}</div>
            <pre class="code-block">${JSON.stringify(props.heartbeat ?? {}, null, 2)}</pre>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${uiLiteral("Manual RPC")}</div>
        <div class="card-sub">${uiLiteral("Send a raw gateway method with JSON params.")}</div>
        <div class="stack" style="margin-top: 16px;">
          <label class="field">
            <span>${uiLiteral("Method")}</span>
            <select
              .value=${props.callMethod}
              @change=${(e: Event) =>
                props.onCallMethodChange((e.target as HTMLSelectElement).value)}
            >
              ${!props.callMethod
                ? html` <option value="" disabled>${uiLiteral("Select a method…")}</option> `
                : nothing}
              ${props.methods.map((m) => html`<option value=${m}>${m}</option>`)}
            </select>
          </label>
          <label class="field">
            <span>${uiLiteral("Params (JSON)")}</span>
            <textarea
              .value=${props.callParams}
              @input=${(e: Event) =>
                props.onCallParamsChange((e.target as HTMLTextAreaElement).value)}
              rows="6"
            ></textarea>
          </label>
        </div>
        <div class="row" style="margin-top: 12px;">
          <button class="btn primary" @click=${props.onCall}>${uiLiteral("Call")}</button>
        </div>
        ${props.callError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.callError}</div>`
          : nothing}
        ${props.callResult
          ? html`<pre class="code-block" style="margin-top: 12px;">${props.callResult}</pre>`
          : nothing}
      </div>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">${uiLiteral("Models")}</div>
      <div class="card-sub">${uiLiteral("Catalog from models.list.")}</div>
      <pre class="code-block" style="margin-top: 12px;">
${JSON.stringify(props.models ?? [], null, 2)}</pre
      >
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">${uiLiteral("Event Log")}</div>
      <div class="card-sub">${uiLiteral("Latest gateway events.")}</div>
      ${props.eventLog.length === 0
        ? html` <div class="muted" style="margin-top: 12px">${uiLiteral("No events yet.")}</div> `
        : html`
            <div class="list debug-event-log" style="margin-top: 12px;">
              ${props.eventLog.map(
                (evt) => html`
                  <div class="list-item debug-event-log__item">
                    <div class="list-main">
                      <div class="list-title">${evt.event}</div>
                      <div class="list-sub">${new Date(evt.ts).toLocaleTimeString()}</div>
                    </div>
                    <div class="list-meta debug-event-log__meta">
                      <pre class="code-block debug-event-log__payload">
${formatEventPayload(evt.payload)}</pre
                      >
                    </div>
                  </div>
                `,
              )}
            </div>
          `}
    </section>
  `;
}
