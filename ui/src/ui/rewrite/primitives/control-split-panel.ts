import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("control-split-panel")
export class ControlSplitPanel extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`<div class="cp-split-panel"><slot></slot></div>`;
  }
}
