import { describe, expect, it, vi } from "vitest";
import { stripAnsi } from "../../terminal/ansi.js";
import type { ChatLogToolState } from "./chat-log.js";
import { ToolOverlayComponent } from "./tool-overlay.js";

function createToolOverlay(params?: {
  tools?: ChatLogToolState[];
  onToggleTool?: (toolCallId: string) => void;
  onToggleAll?: () => void;
  onClose?: () => void;
}) {
  const tools = params?.tools ?? [
    {
      id: "tool-1",
      toolName: "exec",
      status: "running",
      expanded: false,
    },
    {
      id: "tool-2",
      toolName: "read_file",
      status: "error",
      expanded: true,
    },
  ];

  return new ToolOverlayComponent({
    getTools: () => tools,
    onToggleTool: params?.onToggleTool ?? vi.fn(),
    onToggleAll: params?.onToggleAll ?? vi.fn(),
    onClose: params?.onClose ?? vi.fn(),
  });
}

describe("ToolOverlayComponent", () => {
  it("renders tool state and highlights failed tools", () => {
    const overlay = createToolOverlay();

    const rendered = stripAnsi(overlay.render(100).join("\n"));

    expect(rendered).toContain("Tool output");
    expect(rendered).toContain("tool-1");
    expect(rendered).toContain("exec");
    expect(rendered).toContain("running");
    expect(rendered).toContain("collapsed");
    expect(rendered).toContain("tool-2");
    expect(rendered).toContain("read_file");
    expect(rendered).toContain("error");
    expect(rendered).toContain("expanded");
  });

  it("toggles the selected tool with enter", () => {
    const onToggleTool = vi.fn();
    const overlay = createToolOverlay({ onToggleTool });

    overlay.handleInput("\r");

    expect(onToggleTool).toHaveBeenCalledWith("tool-1");
  });

  it("moves selection before toggling a tool", () => {
    const onToggleTool = vi.fn();
    const overlay = createToolOverlay({ onToggleTool });

    overlay.handleInput("\x1b[B");
    overlay.handleInput("\r");

    expect(onToggleTool).toHaveBeenCalledWith("tool-2");
  });

  it("toggles every tool with a", () => {
    const onToggleAll = vi.fn();
    const overlay = createToolOverlay({ onToggleAll });

    overlay.handleInput("a");

    expect(onToggleAll).toHaveBeenCalledTimes(1);
  });

  it("closes on escape", () => {
    const onClose = vi.fn();
    const overlay = createToolOverlay({ onClose });

    overlay.handleInput("\x1b");

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
