import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("agents-screen")
export class AgentsScreen extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--agents">
        <slot name="header"></slot>
        <slot name="band"></slot>
        <div class="cp-stage cp-stage--three-column">
          <slot name="rail"></slot>
          <main class="cp-stage__main">
            <slot></slot>
          </main>
          <slot name="detail"></slot>
        </div>
      </section>
    `;
  }
}
