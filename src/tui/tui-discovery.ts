import { translateTuiText } from "../cli/i18n/tui.js";

export function getDefaultTuiFirstScreenHint() {
  return translateTuiText("tui.tip.firstScreen");
}

export function formatTuiFirstScreenHint() {
  return getDefaultTuiFirstScreenHint();
}
