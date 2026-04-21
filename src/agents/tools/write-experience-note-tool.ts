import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { normalizeNotebookLmConfig } from "../../memory/config/notebooklm.ts";
import { upsertExperienceIndexEntry } from "../../memory/experience/index-store.ts";
import {
  classifyExperienceNoteGuardIssue,
  normalizeExperienceConfidence,
  normalizeExperienceNoteType,
  type ExperienceNoteWriteInput,
} from "../../memory/experience/note.ts";
import { writeNotebookLmExperienceNoteViaCli } from "../../memory/notebooklm/notebooklm-write.ts";
import type { NotebookLmConfigInput } from "../../memory/types/config.ts";
import { stringEnum } from "../schema/typebox.js";
import {
  jsonResult,
  readStringArrayParam,
  readStringParam,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

const EXPERIENCE_NOTE_TYPES = [
  "procedure",
  "decision",
  "runtime_pattern",
  "failure_pattern",
  "workflow_pattern",
  "reference",
] as const;

const EXPERIENCE_CONFIDENCE_VALUES = ["low", "medium", "high"] as const;

const WriteExperienceNoteToolSchema = Type.Object({
  type: stringEnum(EXPERIENCE_NOTE_TYPES, {
    description:
      "Experience note type. Must be one of procedure, decision, runtime_pattern, failure_pattern, workflow_pattern, or reference.",
  }),
  title: Type.String({
    description: "Chinese-readable title for the experience note.",
  }),
  summary: Type.String({
    description: "Short Chinese summary for the reusable experience.",
  }),
  context: Type.Optional(
    Type.String({
      description: "Situation where this experience was learned or should be considered.",
    }),
  ),
  trigger: Type.Optional(
    Type.String({
      description: "Signals that indicate this experience may apply.",
    }),
  ),
  action: Type.Optional(
    Type.String({
      description: "The action or workflow that worked in this situation.",
    }),
  ),
  result: Type.Optional(
    Type.String({
      description: "Observed outcome after applying the action.",
    }),
  ),
  lesson: Type.Optional(
    Type.String({
      description: "Reusable lesson or judgment extracted from the experience.",
    }),
  ),
  appliesWhen: Type.Optional(
    Type.String({
      description: "Boundary where this experience should be applied.",
    }),
  ),
  avoidWhen: Type.Optional(
    Type.String({
      description: "Boundary where this experience should not be applied.",
    }),
  ),
  evidence: Type.Optional(
    Type.Array(Type.String(), {
      description: "Evidence, validation, or source signals supporting the experience.",
    }),
  ),
  confidence: Type.Optional(
    stringEnum(EXPERIENCE_CONFIDENCE_VALUES, {
      description: "Confidence in the experience: low, medium, or high.",
    }),
  ),
  body: Type.Optional(
    Type.String({
      description: "Optional legacy scenario/body text. Prefer context for new writes.",
    }),
  ),
  why: Type.Optional(
    Type.String({
      description: "Optional legacy rationale. Prefer lesson for new writes.",
    }),
  ),
  steps: Type.Optional(
    Type.Array(Type.String(), {
      description: "Detailed steps for procedure or workflow experience.",
    }),
  ),
  validation: Type.Optional(
    Type.Array(Type.String(), {
      description: "Validation steps or checks for the experience.",
    }),
  ),
  signals: Type.Optional(
    Type.Array(Type.String(), {
      description: "Additional symptoms or signals for runtime/failure experience.",
    }),
  ),
  references: Type.Optional(
    Type.Array(Type.String(), {
      description: "References, source locators, or entry points for this experience.",
    }),
  ),
  consequences: Type.Optional(
    Type.Array(Type.String(), {
      description: "Consequences or impacts for decision experience.",
    }),
  ),
  whenToRevisit: Type.Optional(
    Type.String({
      description: "When this experience should be revisited or re-evaluated.",
    }),
  ),
  aliases: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional aliases to improve future lookup.",
    }),
  ),
  tags: Type.Optional(
    Type.Array(Type.String(), {
      description: "Optional tags for notebook search and future recall.",
    }),
  ),
  dedupeKey: Type.Optional(
    Type.String({
      description:
        "Optional stable key used to update the same experience note instead of duplicating it.",
    }),
  ),
});

type ExperienceWriteToolOptions = {
  config?: CrawClawConfig;
};

function resolveNotebookLmExperienceWriteConfig(config?: CrawClawConfig) {
  const notebooklm = normalizeNotebookLmConfig(config?.memory?.notebooklm as NotebookLmConfigInput);
  if (!notebooklm.enabled || !notebooklm.write?.enabled || !notebooklm.write.command.trim()) {
    return null;
  }
  const notebookId = (notebooklm.write.notebookId || notebooklm.cli.notebookId || "").trim();
  if (!notebookId) {
    return null;
  }
  return { notebooklm, notebookId };
}

export function createExperienceWriteTool(
  options?: ExperienceWriteToolOptions,
): AnyAgentTool | null {
  const resolved = resolveNotebookLmExperienceWriteConfig(options?.config);
  if (!resolved) {
    return null;
  }

  return {
    label: "Write Experience Note",
    name: "write_experience_note",
    description:
      "Write a Chinese-readable experience note into NotebookLM. Use this for reusable procedures, decisions, runtime/failure patterns, collaboration workflows, or references. Update existing notes instead of duplicating them.",
    parameters: WriteExperienceNoteToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const type = normalizeExperienceNoteType(readStringParam(params, "type", { required: true }));
      if (!type) {
        throw new ToolInputError(
          "type must be one of: procedure, decision, runtime_pattern, failure_pattern, workflow_pattern, reference",
        );
      }
      const title = readStringParam(params, "title", { required: true });
      const summary = readStringParam(params, "summary", { required: true });
      const context = readStringParam(params, "context");
      const trigger = readStringParam(params, "trigger");
      const action = readStringParam(params, "action");
      const resultText = readStringParam(params, "result");
      const lesson = readStringParam(params, "lesson");
      const appliesWhen = readStringParam(params, "appliesWhen");
      const avoidWhen = readStringParam(params, "avoidWhen");
      const body = readStringParam(params, "body");
      const why = readStringParam(params, "why");
      const whenToRevisit = readStringParam(params, "whenToRevisit");
      const confidence = normalizeExperienceConfidence(readStringParam(params, "confidence"));
      const dedupeKey = readStringParam(params, "dedupeKey");
      const evidence = readStringArrayParam(params, "evidence");
      const steps = readStringArrayParam(params, "steps");
      const validation = readStringArrayParam(params, "validation");
      const signals = readStringArrayParam(params, "signals");
      const references = readStringArrayParam(params, "references");
      const consequences = readStringArrayParam(params, "consequences");
      const aliases = readStringArrayParam(params, "aliases");
      const tags = readStringArrayParam(params, "tags");

      const note: ExperienceNoteWriteInput = {
        type,
        title,
        summary,
        context,
        trigger,
        action,
        result: resultText,
        lesson,
        appliesWhen,
        avoidWhen,
        evidence,
        confidence,
        body,
        why,
        steps,
        validation,
        signals,
        references,
        consequences,
        whenToRevisit,
        aliases,
        tags,
        dedupeKey,
      };

      const guardIssue = classifyExperienceNoteGuardIssue(note);
      if (guardIssue) {
        throw new ToolInputError(guardIssue);
      }

      const result = await writeNotebookLmExperienceNoteViaCli({
        config: resolved.notebooklm,
        note,
      });

      if (!result) {
        throw new ToolInputError("NotebookLM experience write is not configured.");
      }
      if (result.status === "ok") {
        await upsertExperienceIndexEntry({
          note,
          writeResult: result,
        });
      }

      return jsonResult({
        status: result.status,
        action: result.action ?? "upsert",
        notebookId: result.notebookId,
        noteId: result.noteId ?? null,
        title: result.title,
        type,
        dedupeKey: dedupeKey ?? null,
        payloadFile: result.payloadFile,
      });
    },
  };
}
