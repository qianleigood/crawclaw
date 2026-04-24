import type { EmbeddedRunModelSwitchRequest } from "./pi-embedded-runner/runs.js";

export type LiveSessionModelSelection = EmbeddedRunModelSwitchRequest;

export class LiveSessionModelSwitchError extends Error {
  provider: string;
  model: string;
  authProfileId?: string;
  authProfileIdSource?: "auto" | "user";

  constructor(selection: LiveSessionModelSelection) {
    super(`Live session model switch requested: ${selection.provider}/${selection.model}`);
    this.name = "LiveSessionModelSwitchError";
    this.provider = selection.provider;
    this.model = selection.model;
    this.authProfileId = selection.authProfileId;
    this.authProfileIdSource = selection.authProfileIdSource;
  }
}
