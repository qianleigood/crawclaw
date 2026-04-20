import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ControlPageMeta } from "../routes.ts";
import "./control-sidebar.ts";
import "./control-topbar.ts";

@customElement("control-shell")
export class ControlShell extends LitElement {
  @property({ attribute: false }) pages: ControlPageMeta[] = [];
  @property() activePage = "overview";
  @property() collapsed = false;
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

  protected render() {
    return html`
      <div class="cp-shell">
        <control-sidebar
          class="cp-sidebar"
          .pages=${this.pages}
          .activePage=${this.activePage}
          .collapsed=${this.collapsed}
          .eyebrow=${this.eyebrow}
        ></control-sidebar>
        <div class="cp-shell__main">
          <control-topbar
            class="cp-topbar"
            .locale=${this.locale}
            .eyebrow=${this.eyebrow}
            .gatewayVersion=${this.gatewayVersion}
            .connected=${this.connected}
            .pendingCount=${this.pendingCount}
            .costLabel=${this.costLabel}
            .connectionLabel=${this.connectionLabel}
          ></control-topbar>
          <section class="cp-shell__body">
            <slot></slot>
          </section>
        </div>
      </div>
    `;
  }
}
