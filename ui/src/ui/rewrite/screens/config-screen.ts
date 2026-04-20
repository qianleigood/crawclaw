import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("config-screen")
export class ConfigScreen extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--config">
        <slot name="header"></slot>
        <div class="cp-stage cp-stage--two cp-stage--config">
          <slot name="rail"></slot>
          <main class="cp-stage__main">
            <slot></slot>
          </main>
        </div>
      </section>
    `;
  }
}
