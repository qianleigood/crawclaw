import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";

@customElement("usage-screen")
export class UsageScreen extends LitElement {
  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--usage">
        <slot name="header"></slot>
        <div class="cp-usage-console">
          <main class="cp-usage-console__main">
            <slot></slot>
          </main>
          <slot name="detail"></slot>
        </div>
      </section>
    `;
  }
}
