import { translateTuiText } from "../cli/i18n/tui.js";

export const TUI_FIRST_SCREEN_HINT =
  "Tip: /help commands | Ctrl+L model | Ctrl+G agent | Ctrl+P sessions | Ctrl+O tools";

export function formatTuiFirstScreenHint() {
  return translateTuiText("tui.tip.firstScreen");
}
