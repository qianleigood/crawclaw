import { describe, expect, it, vi } from "vitest";
import type { CustomEditor } from "./components/custom-editor.js";
import { registerTuiKeybindings } from "./tui-keybindings.js";

describe("registerTuiKeybindings", () => {
  it("wires editor shortcuts to TUI actions", () => {
    const editor = {} as CustomEditor;
    const actions = {
      handleCtrlC: vi.fn(),
      requestExit: vi.fn(),
      openToolOverlay: vi.fn(),
      openModelSelector: vi.fn(),
      openAgentSelector: vi.fn(),
      openSessionSelector: vi.fn(),
      toggleThinking: vi.fn(),
    };

    registerTuiKeybindings({ editor, ...actions });

    editor.onCtrlC?.();
    editor.onCtrlD?.();
    editor.onCtrlO?.();
    editor.onCtrlL?.();
    editor.onCtrlG?.();
    editor.onCtrlP?.();
    editor.onCtrlT?.();

    expect(actions.handleCtrlC).toHaveBeenCalledTimes(1);
    expect(actions.requestExit).toHaveBeenCalledTimes(1);
    expect(actions.openToolOverlay).toHaveBeenCalledTimes(1);
    expect(actions.openModelSelector).toHaveBeenCalledTimes(1);
    expect(actions.openAgentSelector).toHaveBeenCalledTimes(1);
    expect(actions.openSessionSelector).toHaveBeenCalledTimes(1);
    expect(actions.toggleThinking).toHaveBeenCalledTimes(1);
  });
});
