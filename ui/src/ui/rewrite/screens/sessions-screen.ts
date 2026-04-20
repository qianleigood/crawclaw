import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement("sessions-screen")
export class SessionsScreen extends LitElement {
  @property({ type: Boolean }) maximized = false;

  protected override createRenderRoot() {
    return this;
  }

  protected render() {
    return html`
      <section class="cp-screen cp-screen--sessions">
        <slot name="header"></slot>
        <div class="cp-session-console ${this.maximized ? "is-maximized" : ""}">
          <slot name="rail"></slot>
          <main class="cp-session-console__main">
            <slot></slot>
          </main>
          <slot name="detail"></slot>
        </div>
      </section>
    `;
  }
}
