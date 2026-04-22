import { type Component, isKeyRelease, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { visibleWidth } from "../../terminal/ansi.js";
import { theme } from "../theme/theme.js";
import type { ChatLogToolState } from "./chat-log.js";

type ToolOverlayOptions = {
  getTools: () => ChatLogToolState[];
  onToggleTool: (toolCallId: string) => void;
  onToggleAll: () => void;
  onClose: () => void;
};

const MAX_VISIBLE_TOOLS = 12;
const RIGHT_MARGIN = 2;

export class ToolOverlayComponent implements Component {
  private selectedIndex = 0;

  constructor(private readonly options: ToolOverlayOptions) {}

  invalidate() {}

  render(width: number): string[] {
    const tools = this.options.getTools();
    this.clampSelection(tools);

    const lines = [
      theme.header("Tool output"),
      theme.dim("Enter toggle selected | a toggle all | Esc close"),
      theme.border("-".repeat(Math.max(0, width))),
    ];

    if (tools.length === 0) {
      lines.push(theme.dim("No tool output yet"));
      return lines;
    }

    const startIndex = this.resolveStartIndex(tools.length);
    const endIndex = Math.min(startIndex + MAX_VISIBLE_TOOLS, tools.length);
    for (let index = startIndex; index < endIndex; index++) {
      const tool = tools[index];
      if (!tool) {
        continue;
      }
      lines.push(this.renderToolLine(tool, index === this.selectedIndex, width));
    }

    if (tools.length > MAX_VISIBLE_TOOLS) {
      lines.push(theme.dim(`${this.selectedIndex + 1}/${tools.length}`));
    }

    return lines;
  }

  handleInput(keyData: string): void {
    if (isKeyRelease(keyData)) {
      return;
    }

    if (matchesKey(keyData, "escape") || keyData === "\u0003") {
      this.options.onClose();
      return;
    }

    const tools = this.options.getTools();
    this.clampSelection(tools);

    if (
      matchesKey(keyData, "up") ||
      matchesKey(keyData, "ctrl+p") ||
      (keyData === "k" && tools.length > 0)
    ) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1);
      return;
    }

    if (
      matchesKey(keyData, "down") ||
      matchesKey(keyData, "ctrl+n") ||
      (keyData === "j" && tools.length > 0)
    ) {
      this.selectedIndex = Math.min(tools.length - 1, this.selectedIndex + 1);
      return;
    }

    if (matchesKey(keyData, "enter")) {
      const tool = tools[this.selectedIndex];
      if (tool) {
        this.options.onToggleTool(tool.id);
      }
      return;
    }

    if (keyData === "a" || keyData === "A") {
      this.options.onToggleAll();
    }
  }

  private renderToolLine(tool: ChatLogToolState, selected: boolean, width: number) {
    const prefix = selected ? "> " : "  ";
    const status = this.formatStatus(tool.status);
    const expansion = tool.expanded ? "expanded" : "collapsed";
    const line = `${prefix}${status} ${expansion} ${tool.id} ${tool.toolName}`;
    const maxWidth = Math.max(1, width - RIGHT_MARGIN);
    const truncated = visibleWidth(line) > maxWidth ? truncateToWidth(line, maxWidth, "") : line;
    return selected ? theme.accent(truncated) : truncated;
  }

  private formatStatus(status: ChatLogToolState["status"]) {
    if (status === "error") {
      return theme.error("error");
    }
    if (status === "running") {
      return theme.accentSoft("running");
    }
    return theme.success("done");
  }

  private clampSelection(tools: ChatLogToolState[]) {
    this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, tools.length - 1));
  }

  private resolveStartIndex(total: number) {
    return Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(MAX_VISIBLE_TOOLS / 2), total - MAX_VISIBLE_TOOLS),
    );
  }
}
