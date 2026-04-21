import { createCliTranslator, resolveCliLocaleFromRuntime } from "../../cli/i18n/index.js";
import type { CrawClawConfig } from "../../config/config.js";

export async function finalizeDoctorConfigFlow(params: {
  cfg: CrawClawConfig;
  candidate: CrawClawConfig;
  pendingChanges: boolean;
  shouldRepair: boolean;
  fixHints: string[];
  confirm: (p: { message: string; initialValue: boolean }) => Promise<boolean>;
  note: (message: string, title?: string) => void;
}): Promise<{ cfg: CrawClawConfig; shouldWriteConfig: boolean }> {
  const t = createCliTranslator(resolveCliLocaleFromRuntime(process.argv));
  if (!params.shouldRepair && params.pendingChanges) {
    const shouldApply = await params.confirm({
      message: t("doctor.finalize.applyRecommended"),
      initialValue: true,
    });
    if (shouldApply) {
      return {
        cfg: params.candidate,
        shouldWriteConfig: true,
      };
    }
    if (params.fixHints.length > 0) {
      params.note(params.fixHints.join("\n"), t("doctor.title"));
    }
    return {
      cfg: params.cfg,
      shouldWriteConfig: false,
    };
  }

  if (params.shouldRepair && params.pendingChanges) {
    return {
      cfg: params.cfg,
      shouldWriteConfig: true,
    };
  }

  return {
    cfg: params.cfg,
    shouldWriteConfig: false,
  };
}
