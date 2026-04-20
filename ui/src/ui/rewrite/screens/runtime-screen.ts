import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("runtime-screen")
export class RuntimeScreen extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--runtime">
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
