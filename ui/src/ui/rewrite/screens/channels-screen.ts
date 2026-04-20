import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ChannelsScreenMode } from "./screen-types.ts";

@customElement("channels-screen")
export class ChannelsScreen extends LitElement {
  @property() mode: ChannelsScreenMode = "management";

  protected override createRenderRoot() {
    return this;
  }

  private renderActiveFlow() {
    switch (this.mode) {
      case "catalog":
        return html`
          <section class="cp-channel-catalog" data-flow="catalog">
            <slot name="catalog"></slot>
          </section>
        `;
      case "editor":
        return html`
          <section class="cp-channel-editor" data-flow="editor">
            <slot name="editor"></slot>
          </section>
        `;
      default:
        return html`
          <section class="cp-channels-management" data-flow="management">
            <slot></slot>
          </section>
        `;
    }
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--channels">
        <slot name="header"></slot>
        ${this.renderActiveFlow()}
      </section>
    `;
  }
}
