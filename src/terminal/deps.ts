import type { OutboundSendDeps } from "../infra/outbound/send-deps.js";
import { createOutboundSendDepsFromCliSource } from "./outbound-send-mapping.js";

/**
 * Lazy-loaded per-channel send functions, keyed by channel ID.
 * Values are proxy functions that dynamically import the real module on first use.
 */
export type CliDeps = { [channelId: string]: unknown };

export function createDefaultDeps(): CliDeps {
  // Keep the default dependency barrel limited to lazy senders so callers that
  // only need outbound deps do not pull channel runtime boundaries on import.
  return {
    // China-first bundled channels are served through plugin/native channel
    // dispatchers, not legacy direct CLI sender modules.
  };
}

export function createOutboundSendDeps(deps: CliDeps): OutboundSendDeps {
  return createOutboundSendDepsFromCliSource(deps);
}
