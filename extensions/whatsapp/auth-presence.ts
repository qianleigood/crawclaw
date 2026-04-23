import type { CrawClawConfig } from "crawclaw/plugin-sdk/config-runtime";
import { hasAnyWhatsAppAuth as hasAnyCoreWhatsAppAuth } from "crawclaw/plugin-sdk/whatsapp-auth-presence";

type WhatsAppAuthPresenceParams =
  | {
      cfg: CrawClawConfig;
      env?: NodeJS.ProcessEnv;
    }
  | CrawClawConfig;

export function hasAnyWhatsAppAuth(
  params: WhatsAppAuthPresenceParams,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const cfg = params && typeof params === "object" && "cfg" in params ? params.cfg : params;
  const resolvedEnv =
    params && typeof params === "object" && "cfg" in params ? (params.env ?? env) : env;
  return hasAnyCoreWhatsAppAuth(cfg, resolvedEnv);
}
