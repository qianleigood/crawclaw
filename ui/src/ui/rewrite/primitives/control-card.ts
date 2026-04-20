import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("control-card")
export class ControlCard extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`<section class="cp-card"><slot></slot></section>`;
  }
}
