import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ControlPageMeta } from "../routes.ts";
import "./control-sidebar.ts";
import "./control-topbar.ts";

@customElement("control-shell")
export class ControlShell extends LitElement {
  @property({ attribute: false }) pages: ControlPageMeta[] = [];
  @property() activePage = "sessions";
  @property() collapsed = false;
  @property() locale: "en" | "zh-CN" = "en";
  @property() eyebrow = "Control UI";
  @property() gatewayVersion = "gateway";
  @property() connected = false;
  @property({ type: Number }) pendingCount = 0;
  @property() costLabel = "$0.00";
  @property() connectionLabel = "Offline";
  @property({ attribute: false }) body: unknown = nothing;
  private cachedLegacyChildren: HTMLElement[] | null = null;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    if (this.cachedLegacyChildren == null) {
      this.cachedLegacyChildren = Array.from(this.children).filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && !node.classList.contains("cp-shell"),
      );
    }
    super.connectedCallback();
  }

  private legacyNodes(slotName?: string) {
    return (this.cachedLegacyChildren ?? Array.from(this.children)).filter((node) => {
      const currentSlot = node.getAttribute("slot");
      if (slotName) {
        return currentSlot === slotName;
      }
      return currentSlot == null;
    });
  }

  protected render() {
    return html`
      <div class="cp-shell ${this.collapsed ? "is-nav-collapsed" : ""}">
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
            ${this.body === nothing ? this.legacyNodes() : this.body}
          </section>
        </div>
      </div>
    `;
  }
}
