import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("control-topbar")
export class ControlTopbar extends LitElement {
  @property() locale: "en" | "zh-CN" = "en";
  @property() eyebrow = "Control UI";
  @property() gatewayVersion = "gateway";
  @property() connected = false;
  @property({ type: Number }) pendingCount = 0;
  @property() costLabel = "$0.00";
  @property() connectionLabel = "Offline";

  protected override createRenderRoot() {
    return this;
  }

  private emitLocaleChange(event: Event) {
    const target = event.target as HTMLSelectElement | null;
    const locale = target?.value === "zh-CN" ? "zh-CN" : "en";
    this.dispatchEvent(
      new CustomEvent("locale-change", {
        bubbles: true,
        composed: true,
        detail: { locale },
      }),
    );
  }

  private emitRefresh() {
    this.dispatchEvent(
      new CustomEvent("refresh-request", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private emitReconnect() {
    this.dispatchEvent(
      new CustomEvent("reconnect-request", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected render() {
    const language = this.locale === "zh-CN" ? "中文" : "English";
    const connectionState = this.connected ? "Connected" : "Disconnected";
    return html`
      <header class="cp-topbar">
        <div class="cp-topbar__identity">
          <div class="cp-topbar__eyebrow">${this.eyebrow}</div>
          <div class="cp-topbar__gateway-version">${this.gatewayVersion}</div>
        </div>
        <div class="cp-topbar__stats">
          <span class="cp-topbar__stat cp-topbar__stat--connection">${this.connectionLabel}</span>
          <span class="cp-topbar__stat cp-topbar__stat--pending">Pending ${this.pendingCount}</span>
          <span class="cp-topbar__stat cp-topbar__stat--cost">${this.costLabel}</span>
          <span
            class="cp-topbar__stat cp-topbar__stat--connected ${this.connected
              ? "is-online"
              : "is-offline"}"
            aria-label=${connectionState}
          >
            ${connectionState}
          </span>
        </div>
        <div class="cp-topbar__actions">
          <label class="cp-topbar__locale-picker">
            <span class="cp-topbar__locale-copy">${language}</span>
            <select
              class="cp-topbar__locale-select"
              .value=${this.locale}
              @change=${(event: Event) => this.emitLocaleChange(event)}
            >
              <option value="en">English</option>
              <option value="zh-CN">中文</option>
            </select>
          </label>
          <button
            class="cp-topbar__icon-button"
            type="button"
            aria-label="Refresh"
            @click=${() => this.emitRefresh()}
          >
            <span class="material-symbols-outlined">refresh</span>
          </button>
          <button
            class="cp-topbar__icon-button"
            type="button"
            aria-label="Reconnect"
            @click=${() => this.emitReconnect()}
          >
            <span class="material-symbols-outlined">sync</span>
          </button>
        </div>
      </header>
    `;
  }
}
