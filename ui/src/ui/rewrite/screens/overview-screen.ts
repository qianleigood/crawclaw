import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("overview-screen")
export class OverviewScreen extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--overview">
        <slot name="header"></slot>
        <div class="cp-stage cp-stage--overview">
          <div class="cp-stage__main">
            <slot></slot>
          </div>
        </div>
      </section>
    `;
  }
}
