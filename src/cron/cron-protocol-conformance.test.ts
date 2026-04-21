import { describe, expect, it } from "vitest";
import { CronDeliverySchema, CronJobStateSchema } from "../gateway/protocol/schema.js";
import type { CronDeliveryMode } from "./types.js";

type SchemaLike = {
  anyOf?: Array<SchemaLike>;
  properties?: Record<string, unknown>;
  const?: unknown;
};

function extractDeliveryModes(schema: SchemaLike): string[] {
  const modeSchema = schema.properties?.mode as SchemaLike | undefined;
  const directModes = (modeSchema?.anyOf ?? [])
    .map((entry) => entry?.const)
    .filter((value): value is string => typeof value === "string");
  if (directModes.length > 0) {
    return directModes;
  }

  const unionModes = (schema.anyOf ?? [])
    .map((entry) => {
      const mode = entry.properties?.mode as SchemaLike | undefined;
      return mode?.const;
    })
    .filter((value): value is string => typeof value === "string");

  return Array.from(new Set(unionModes));
}

function extractConstUnionValues(schema: SchemaLike): string[] {
  return Array.from(
    new Set(
      (schema.anyOf ?? [])
        .map((entry) => entry?.const)
        .filter((value): value is string => typeof value === "string"),
    ),
  );
}

const RUNTIME_DELIVERY_MODES = [
  "none",
  "announce",
  "webhook",
] as const satisfies readonly CronDeliveryMode[];

describe("cron protocol conformance", () => {
  it("gateway schema includes all runtime cron delivery modes", () => {
    const modes = extractDeliveryModes(CronDeliverySchema as SchemaLike);
    expect(modes).toEqual([...RUNTIME_DELIVERY_MODES]);
  });

  it("cron job state schema keeps the full failover reason set", () => {
    const properties = (CronJobStateSchema as SchemaLike).properties ?? {};
    const lastErrorReason = properties.lastErrorReason as SchemaLike | undefined;
    expect(lastErrorReason).toBeDefined();
    expect(extractConstUnionValues(lastErrorReason ?? {})).toEqual([
      "auth",
      "format",
      "rate_limit",
      "billing",
      "timeout",
      "model_not_found",
      "unknown",
    ]);
  });
});
