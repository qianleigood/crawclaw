import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ControlPageMeta } from "../routes.ts";

@customElement("control-sidebar")
export class ControlSidebar extends LitElement {
  @property({ attribute: false }) pages: ControlPageMeta[] = [];
  @property() activePage = "overview";
  @property() collapsed = false;
  @property() eyebrow = "CrawClaw";

  protected override createRenderRoot() {
    return this;
  }

  private emitNavigate(pageId: string) {
    this.dispatchEvent(
      new CustomEvent("navigate", {
        bubbles: true,
        composed: true,
        detail: { page: pageId },
      }),
    );
  }

  private emitRailToggle() {
    this.dispatchEvent(
      new CustomEvent("toggle-rail", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected render() {
    return html`
      <aside class="cp-sidebar ${this.collapsed ? "is-collapsed" : ""}">
        <div class="cp-sidebar__brand-row">
          <div class="cp-sidebar__brand-block">
            <div class="cp-sidebar__eyebrow">${this.eyebrow}</div>
            <div class="cp-sidebar__brand">CrawClaw</div>
          </div>
          <button
            class="cp-sidebar__rail-toggle cp-topbar__icon-button"
            type="button"
            aria-label=${this.collapsed ? "Expand navigation" : "Collapse navigation"}
            aria-pressed=${String(this.collapsed)}
            @click=${() => this.emitRailToggle()}
          >
            <span class="material-symbols-outlined">
              ${this.collapsed ? "right_panel_open" : "left_panel_close"}
            </span>
          </button>
        </div>
        <nav class="cp-sidebar__nav" aria-label="Control UI">
          ${this.pages.map(
            (page) => html`
              <button
                class="cp-sidebar__item ${page.id === this.activePage ? "is-active" : ""}"
                type="button"
                aria-current=${page.id === this.activePage ? "page" : "false"}
                @click=${() => this.emitNavigate(page.id)}
              >
                <span class="material-symbols-outlined">${page.icon}</span>
                ${this.collapsed
                  ? null
                  : html`
                      <span class="cp-sidebar__copy">
                        <span class="cp-sidebar__label">${page.label}</span>
                        <small>${page.eyebrow}</small>
                      </span>
                    `}
              </button>
            `,
          )}
        </nav>
      </aside>
    `;
  }
}
