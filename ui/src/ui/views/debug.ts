import { html, nothing } from "lit";
import { formatEventPayload } from "../presenter.ts";
import type { EventLogEntry } from "../types/event-log.ts";
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
  const methodCount = props.methods.length;
  const modelCount = props.models.length;
  const eventCount = props.eventLog.length;
  const preferredMethods = props.methods.filter(
    (method) => method.startsWith("system.") || method.startsWith("channels.login."),
  );
  const legacyAliasList = props.methods.filter((method) =>
    ["health", "status", "last-heartbeat", "web.login.start", "web.login.wait"].includes(method),
  );
  const preferredMethodCount = preferredMethods.length;
  const legacyAliasCount = legacyAliasList.length;
  const selectedMethod = props.callMethod.trim() || uiLiteral("Not selected");
  const paramsState = resolveParamsState(props.callParams);
  const rpcState = props.callError
    ? uiLiteral("Error")
    : props.callResult
      ? uiLiteral("Ready")
      : uiLiteral("Idle");

  return html`
    <section class="control-console-stage control-console-stage--debug">
      <section class="control-console-head">
        <div class="control-console-head__top">
          <div class="control-console-head__copy">
            <div class="control-console-head__eyebrow">${uiLiteral("Ops_console_v2.4 / telemetry / security / logs")}</div>
            <h1 class="control-console-head__title">${uiLiteral("Debug & RPC console")}</h1>
            <p class="control-console-head__summary">
              ${uiLiteral(
                "Inspect snapshots, method surface, preferred names, aliases, and raw gateway RPC traffic from one engineering console.",
              )}
            </p>
          </div>
          <div class="control-console-head__actions">
            <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
              ${props.loading ? uiLiteral("Refreshing…") : uiLiteral("Refresh")}
            </button>
          </div>
        </div>
        <div class="control-console-head__meta">
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Preferred surface")}</span>
            <strong class="control-console-head__meta-value">${preferredMethodCount}</strong>
            <span class="control-console-head__meta-note"
              >${uiLiteral("system.* and channels.login.* available")}</span
            >
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Legacy aliases")}</span>
            <strong class="control-console-head__meta-value">${legacyAliasCount}</strong>
            <span class="control-console-head__meta-note"
              >${uiLiteral("Compatibility surface still exposed")}</span
            >
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Manual RPC")}</span>
            <strong class="control-console-head__meta-value">${rpcState}</strong>
            <span class="control-console-head__meta-note">${selectedMethod}</span>
          </div>
          <div class="control-console-head__meta-card">
            <span class="control-console-head__meta-label">${uiLiteral("Security audit")}</span>
            <strong class="control-console-head__meta-value">${securityLabel}</strong>
            <span class="control-console-head__meta-note"
              >${critical} ${uiLiteral("critical")} · ${warn} ${uiLiteral("warnings")} · ${info}
              ${uiLiteral("info")}</span
            >
          </div>
        </div>
      </section>
      <div class="console-kpi-band">
        <div class="console-kpi-card">
          <span class="console-kpi-card__label">${uiLiteral("Signal")}</span>
          <strong class="console-kpi-card__value">${props.loading ? uiLiteral("Refreshing") : uiLiteral("Stable")}</strong>
          <span class="console-kpi-card__meta">${uiLiteral("Method and event surface probe")}</span>
        </div>
        <div class="console-kpi-card console-kpi-card--stable">
          <span class="console-kpi-card__label">${uiLiteral("Preferred names")}</span>
          <strong class="console-kpi-card__value">${preferredMethodCount}</strong>
          <span class="console-kpi-card__meta">${uiLiteral("system.* and channels.login.*")}</span>
        </div>
        <div class="console-kpi-card console-kpi-card--warn">
          <span class="console-kpi-card__label">${uiLiteral("Legacy aliases")}</span>
          <strong class="console-kpi-card__value">${legacyAliasCount}</strong>
          <span class="console-kpi-card__meta">${uiLiteral("Compatibility surface still exposed")}</span>
        </div>
        <div class="console-kpi-card ${critical > 0 ? "console-kpi-card--danger" : "console-kpi-card--info"}">
          <span class="console-kpi-card__label">${uiLiteral("Security audit")}</span>
          <strong class="console-kpi-card__value">${securityLabel}</strong>
          <span class="console-kpi-card__meta">${uiLiteral("Critical / warn / info summary")}</span>
        </div>
      </div>

      <div class="debug-console-grid">
        <aside class="debug-console-grid__rail">
          <section class="card debug-method-rail">
            <div class="debug-method-rail__header">
              <div>
                <div class="card-title">${uiLiteral("Method surface")}</div>
                <div class="card-sub">
                  ${uiLiteral("Preferred names, aliases, and callable gateway methods.")}
                </div>
              </div>
              <span class="agent-pill">${methodCount} ${uiLiteral("methods")}</span>
            </div>

            <div class="debug-surface-strip debug-surface-strip--rail">
              <div class="debug-surface-card">
                <span class="debug-surface-card__label">${uiLiteral("Preferred names")}</span>
                <strong class="debug-surface-card__value">${preferredMethodCount}</strong>
                <span class="debug-surface-card__meta"
                  >${uiLiteral("system.* and channels.login.* available")}</span
                >
              </div>
              <div class="debug-surface-card">
                <span class="debug-surface-card__label">${uiLiteral("Legacy aliases")}</span>
                <strong class="debug-surface-card__value">${legacyAliasCount}</strong>
                <span class="debug-surface-card__meta"
                  >${uiLiteral("Compatibility surface still exposed")}</span
                >
              </div>
              <div class="debug-surface-card">
                <span class="debug-surface-card__label">${uiLiteral("Selected method")}</span>
                <strong class="debug-surface-card__value">${selectedMethod}</strong>
                <span class="debug-surface-card__meta">${uiLiteral("Manual RPC target")}</span>
              </div>
              <div class="debug-surface-card">
                <span class="debug-surface-card__label">${uiLiteral("Params state")}</span>
                <strong class="debug-surface-card__value">${paramsState}</strong>
                <span class="debug-surface-card__meta"
                  >${uiLiteral("JSON payload validation before send")}</span
                >
              </div>
            </div>

            <div class="debug-method-rail__group">
              <span class="debug-method-rail__label">${uiLiteral("Preferred names")}</span>
              <div class="debug-method-rail__list">
                ${preferredMethods
                  .slice(0, 10)
                  .map((method) => html`<span class="debug-method-pill">${method}</span>`)}
              </div>
            </div>

            ${
              legacyAliasList.length > 0
                ? html`
                    <div class="debug-method-rail__group">
                      <span class="debug-method-rail__label">${uiLiteral("Legacy aliases")}</span>
                      <div class="debug-method-rail__list">
                        ${legacyAliasList.map(
                          (method) =>
                            html`<span class="debug-method-pill debug-method-pill--alias"
                              >${method}</span
                            >`,
                        )}
                      </div>
                    </div>
                  `
                : nothing
            }
          </section>

          <section class="card debug-models-rail">
            <div class="card-title">${uiLiteral("Models")}</div>
            <div class="card-sub">${uiLiteral("Catalog from models.list.")}</div>
            <div class="debug-models-rail__meta">
              <span>${modelCount} ${uiLiteral("models")}</span>
            </div>
            <pre class="code-block" style="margin-top: 12px;">
${JSON.stringify(props.models ?? [], null, 2)}</pre
            >
          </section>
        </aside>

        <div class="debug-console-grid__main">
          <section class="debug-grid">
          <div class="card">
            <div class="row" style="justify-content: space-between;">
              <div>
                <div class="card-title">${uiLiteral("Snapshots")}</div>
                <div class="card-sub">${uiLiteral("Status, health, and heartbeat data.")}</div>
              </div>
            </div>
            <div class="stack" style="margin-top: 12px;">
              <div>
                <div class="muted">${uiLiteral("Status")}</div>
                ${
                  securitySummary
                    ? html`<div class="callout ${securityTone}" style="margin-top: 8px;">
                        ${uiLiteral("Security audit")}:
                        ${securityLabel}${info > 0 ? ` · ${info} ${uiLiteral("info")}` : ""}.
                        ${uiLiteral("Run")}
                        <span class="mono">crawclaw security audit --deep</span> ${uiLiteral(
                          "for details.",
                        )}
                      </div>`
                    : nothing
                }
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
            <div class="debug-rpc-hint">
              <span class="debug-rpc-hint__label">${uiLiteral("Preferred surface")}</span>
              <span class="debug-rpc-hint__value">
                ${uiLiteral(
                  "Use system.health / system.status / system.heartbeat.last / channels.login.* when available.",
                )}
              </span>
            </div>
            <div class="stack" style="margin-top: 16px;">
              <label class="field">
                <span>${uiLiteral("Method")}</span>
                <select
                  .value=${props.callMethod}
                  @change=${(e: Event) =>
                    props.onCallMethodChange((e.target as HTMLSelectElement).value)}
                >
                  ${
                    !props.callMethod
                      ? html` <option value="" disabled>${uiLiteral("Select a method…")}</option> `
                      : nothing
                  }
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
            ${
              props.callError
                ? html`<div class="callout danger" style="margin-top: 12px;">
                    ${props.callError}
                  </div>`
                : nothing
            }
            ${
              props.callResult
                ? html`<pre class="code-block" style="margin-top: 12px;">${props.callResult}</pre>`
                : nothing
            }
          </div>
        </section>
          <section class="card">
            <div class="card-title">${uiLiteral("Event Log")}</div>
            <div class="card-sub">${uiLiteral("Latest gateway events.")}</div>
            <div class="debug-models-rail__meta">
              <span>${eventCount} ${uiLiteral("events")}</span>
            </div>
            ${
              props.eventLog.length === 0
                ? html`
                    <div class="muted" style="margin-top: 12px">${uiLiteral("No events yet.")}</div>
                  `
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
                  `
            }
          </section>
        </div>
      </section>
    </section>
  `;
}

function resolveParamsState(callParams: string): string {
  const value = callParams.trim();
  if (!value) {
    return uiLiteral("Default object");
  }
  try {
    JSON.parse(value);
    return uiLiteral("Valid JSON");
  } catch {
    return uiLiteral("Invalid JSON");
  }
}
