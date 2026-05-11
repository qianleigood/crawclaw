import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { stringEnum } from "../schema/typebox.js";
import { type AnyAgentTool, jsonResult } from "./common.js";

const CANVAS_ACTIONS = ["present", "hide", "navigate", "eval", "snapshot"] as const;

const CanvasToolSchema = Type.Object({
  action: stringEnum(CANVAS_ACTIONS),
});

export function createCanvasTool(_options?: { config?: CrawClawConfig }): AnyAgentTool {
  return {
    label: "Canvas",
    name: "canvas",
    description: "Canvas control is unavailable in current CrawClaw builds.",
    parameters: CanvasToolSchema,
    execute: async () =>
      jsonResult({
        ok: false,
        error: "Canvas control is unavailable in current CrawClaw builds.",
      }),
  };
}
