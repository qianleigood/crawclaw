import type { ObservationContext, ObservationRefValue } from "./types.js";

export type ObservationTimelineSource =
  | "lifecycle"
  | "diagnostic"
  | "action"
  | "archive"
  | "trajectory"
  | "log"
  | "otel";

export type ObservationTimelineEntry = {
  source: ObservationTimelineSource;
  type: string;
  createdAt: number;
  observation: ObservationContext;
  status?: string;
  summary: string;
  metrics?: Record<string, number>;
  refs?: Record<string, ObservationRefValue>;
};
