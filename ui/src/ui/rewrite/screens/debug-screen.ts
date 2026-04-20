import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("debug-screen")
export class DebugScreen extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--debug">
        <slot name="header"></slot>
        <div class="cp-debug-console">
          <slot name="rail"></slot>
          <main class="cp-debug-console__main">
            <slot></slot>
          </main>
        </div>
      </section>
    `;
  }
}
