import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("control-list-row")
export class ControlListRow extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`<div class="cp-list-row"><slot></slot></div>`;
  }
}
