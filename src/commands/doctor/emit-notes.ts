import { createCliTranslator, resolveCliLocaleFromRuntime } from "../../cli/i18n/index.js";

export function emitDoctorNotes(params: {
  note: (message: string, title?: string) => void;
  changeNotes?: string[];
  warningNotes?: string[];
}): void {
  const t = createCliTranslator(resolveCliLocaleFromRuntime(process.argv));
  for (const change of params.changeNotes ?? []) {
    params.note(change, t("doctor.notes.changes"));
  }
  for (const warning of params.warningNotes ?? []) {
    params.note(warning, t("doctor.notes.warnings"));
  }
}
