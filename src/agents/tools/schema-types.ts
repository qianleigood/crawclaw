import type { TSchema as LegacyTypeBoxSchema } from "@sinclair/typebox";
import type { TSchema as PiTypeBoxSchema } from "typebox";

export type CrawClawJsonSchema = Record<string, unknown>;
export type CrawClawToolSchema = LegacyTypeBoxSchema | PiTypeBoxSchema | CrawClawJsonSchema;
export type CrawClawToolSchemaProperties = Record<string, CrawClawToolSchema>;
