import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";
import { uiLiteral } from "../ui-literal.ts";

export type MarkdownSidebarProps = {
  content: string | null;
  error: string | null;
  onClose: () => void;
  onViewRawText: () => void;
};

export function renderMarkdownSidebar(props: MarkdownSidebarProps) {
  const contentMode = props.error
    ? uiLiteral("Error")
    : props.content
      ? uiLiteral("Rendered")
      : uiLiteral("Empty");
  return html`
    <div class="sidebar-panel">
      <div class="sidebar-header">
        <div>
          <div class="sidebar-title">${uiLiteral("Inspector")}</div>
          <div class="sidebar-subtitle">${uiLiteral("Tool output and markdown preview")}</div>
        </div>
        <div class="sidebar-actions">
          ${props.content
            ? html`
                <button @click=${props.onViewRawText} class="btn btn--sm btn--ghost" type="button">
                  ${uiLiteral("View raw")}
                </button>
              `
            : null}
          <button @click=${props.onClose} class="btn btn--sm" title="Close sidebar" type="button">
            ${icons.x}
          </button>
        </div>
      </div>
      <div class="sidebar-meta-strip">
        <span class="sidebar-meta-pill">${uiLiteral("Panel")}: ${uiLiteral("Markdown")}</span>
        <span class="sidebar-meta-pill">${uiLiteral("Mode")}: ${contentMode}</span>
      </div>
      <div class="sidebar-content">
        ${props.error
          ? html`
              <div class="callout danger">${props.error}</div>
              <button
                @click=${props.onViewRawText}
                class="btn"
                style="margin-top: 12px;"
                type="button"
              >
                ${uiLiteral("View raw text")}
              </button>
            `
          : props.content
            ? html`<div class="sidebar-markdown">
                ${unsafeHTML(toSanitizedMarkdownHtml(props.content))}
              </div>`
            : html` <div class="muted">${uiLiteral("No content available")}</div> `}
      </div>
    </div>
  `;
}
