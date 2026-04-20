import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ChannelsScreenMode } from "./screen-types.ts";

@customElement("channels-screen")
export class ChannelsScreen extends LitElement {
  @property() mode: ChannelsScreenMode = "management";
  @property({ attribute: false }) header: unknown = nothing;
  @property({ attribute: false }) management: unknown = nothing;
  @property({ attribute: false }) catalog: unknown = nothing;
  @property({ attribute: false }) editor: unknown = nothing;
  private cachedLegacyChildren: HTMLElement[] | null = null;

  protected override createRenderRoot() {
    return this;
  }

  override connectedCallback() {
    if (this.cachedLegacyChildren == null) {
      this.cachedLegacyChildren = Array.from(this.children).filter(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && !node.classList.contains("cp-screen"),
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

  private renderActiveFlow() {
    switch (this.mode) {
      case "catalog":
        return html`
          <section class="cp-channel-catalog" data-flow="catalog">
            ${this.catalog === nothing ? this.legacyNodes("catalog") : this.catalog}
          </section>
        `;
      case "editor":
        return html`
          <section class="cp-channel-editor" data-flow="editor">
            ${this.editor === nothing ? this.legacyNodes("editor") : this.editor}
          </section>
        `;
      default:
        return html`
          <section class="cp-channels-management" data-flow="management">
            ${this.management === nothing ? this.legacyNodes() : this.management}
          </section>
        `;
    }
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--channels">
        ${this.header === nothing ? this.legacyNodes("header") : this.header}
        ${this.renderActiveFlow()}
      </section>
    `;
  }
}
