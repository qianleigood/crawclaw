import type { CustomEditor } from "./components/custom-editor.js";

type MaybeAsyncAction = () => void | Promise<void>;

type KeybindingEditor = Pick<
  CustomEditor,
  "onCtrlC" | "onCtrlD" | "onCtrlG" | "onCtrlL" | "onCtrlO" | "onCtrlP" | "onCtrlT"
>;

export type TuiKeybindingActions = {
  editor: KeybindingEditor;
  handleCtrlC: () => void;
  requestExit: () => void;
  openToolOverlay: () => void;
  openModelSelector: MaybeAsyncAction;
  openAgentSelector: MaybeAsyncAction;
  openSessionSelector: MaybeAsyncAction;
  toggleThinking: MaybeAsyncAction;
};

export function registerTuiKeybindings(actions: TuiKeybindingActions) {
  actions.editor.onCtrlC = () => {
    actions.handleCtrlC();
  };
  actions.editor.onCtrlD = () => {
    actions.requestExit();
  };
  actions.editor.onCtrlO = () => {
    actions.openToolOverlay();
  };
  actions.editor.onCtrlL = () => {
    void actions.openModelSelector();
  };
  actions.editor.onCtrlG = () => {
    void actions.openAgentSelector();
  };
  actions.editor.onCtrlP = () => {
    void actions.openSessionSelector();
  };
  actions.editor.onCtrlT = () => {
    void actions.toggleThinking();
  };
}
