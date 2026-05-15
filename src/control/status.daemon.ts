import { resolveGatewayService } from "../daemon/service.js";
import { formatDaemonRuntimeShort } from "./status.format.js";
import { readServiceStatusSummary } from "./status.service-summary.js";

type DaemonStatusSummary = {
  label: string;
  installed: boolean | null;
  loaded: boolean;
  managedByCrawClaw: boolean;
  externallyManaged: boolean;
  loadedText: string;
  runtimeShort: string | null;
};

export async function getDaemonStatusSummary(): Promise<DaemonStatusSummary> {
  const summary = await readServiceStatusSummary(resolveGatewayService(), "Daemon");
  return {
    label: summary.label,
    installed: summary.installed,
    loaded: summary.loaded,
    managedByCrawClaw: summary.managedByCrawClaw,
    externallyManaged: summary.externallyManaged,
    loadedText: summary.loadedText,
    runtimeShort: formatDaemonRuntimeShort(summary.runtime),
  };
}
