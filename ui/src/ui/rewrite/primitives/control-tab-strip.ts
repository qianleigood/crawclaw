import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("control-tab-strip")
export class ControlTabStrip extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`<div class="cp-tab-strip"><slot></slot></div>`;
  }
}
