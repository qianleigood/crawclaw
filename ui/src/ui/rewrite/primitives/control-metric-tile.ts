import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("control-metric-tile")
export class ControlMetricTile extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`<section class="cp-metric-tile"><slot></slot></section>`;
  }
}
