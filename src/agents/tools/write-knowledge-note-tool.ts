import { Type } from "@sinclair/typebox";
import type { CrawClawConfig } from "../../config/config.js";
import { normalizeNotebookLmConfig } from "../../memory/config/notebooklm.ts";
import type { NotebookLmConfigInput } from "../../memory/types/config.ts";
import { writeNotebookLmKnowledgeNoteViaCli } from "../../memory/notebooklm/notebooklm-write.ts";
import {
  classifyKnowledgeNoteGuardIssue,
  normalizeKnowledgeNoteType,
  type KnowledgeNoteWriteInput,
} from "../../memory/notebooklm/knowledge-note.ts";
import { stringEnum } from "../schema/typebox.js";
import { jsonResult, readStringArrayParam, readStringParam, ToolInputError, type AnyAgentTool } from "./common.js";

const KNOWLEDGE_NOTE_TYPES = ["procedure", "decision", "runtime_pattern", "reference"] as const;

const WriteKnowledgeNoteToolSchema = Type.Object({
  type: stringEnum(KNOWLEDGE_NOTE_TYPES, {
    description: "Knowledge note type. Must be one of procedure, decision, runtime_pattern, or reference.",
  }),
  title: Type.String({
    description: "Chinese-readable title for the knowledge note.",
  }),
  summary: Type.String({
    description: "Short Chinese summary for the knowledge note.",
  }),
  body: Type.Optional(
    Type.String({
      description: "Optional longer body or scenario description for the note.",
    }),
  ),
  why: Type.Optional(
    Type.String({
      description: "Why this knowledge matters or why the decision exists.",
    }),
  ),
  steps: Type.Optional(
    Type.Array(Type.String(), {
      description: "Ordered steps for procedure notes, or practical response steps for patterns.",
    }),
  ),
  validation: Type.Optional(
    Type.Array(Type.String(), {
      description: "Validation steps or checks for procedure notes.",
    }),
  ),
  signals: Type.Optional(
    Type.Array(Type.String(), {
      description: "Signals or symptoms for runtime pattern notes.",
    }),
  ),
  references: Type.Optional(
    Type.Array(Type.String(), {
      description: "References, source locators, or entry points for the note.",
    }),
  ),
  consequences: Type.Optional(
    Type.Array(Type.String(), {
      description: "Consequences or impacts for decision notes.",
    }),
  ),
  whenToRevisit: Type.Optional(
    Type.String({
      description: "When this note should be revisited or re-evaluated.",
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
      description: "Optional stable key used to update the same knowledge note instead of duplicating it.",
    }),
  ),
});

type KnowledgeWriteToolOptions = {
  config?: CrawClawConfig;
};

function resolveNotebookLmKnowledgeWriteConfig(config?: CrawClawConfig) {
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

export function createKnowledgeWriteTool(options?: KnowledgeWriteToolOptions): AnyAgentTool | null {
  const resolved = resolveNotebookLmKnowledgeWriteConfig(options?.config);
  if (!resolved) {
    return null;
  }

  return {
    label: "Write Knowledge Note",
    name: "write_knowledge_note",
    description:
      "Write a Chinese-readable knowledge note into NotebookLM. Use this for stable procedures, decisions, runtime patterns, or references. Update existing notes instead of duplicating them.",
    parameters: WriteKnowledgeNoteToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const type = normalizeKnowledgeNoteType(readStringParam(params, "type", { required: true }));
      if (!type) {
        throw new ToolInputError("type must be one of: procedure, decision, runtime_pattern, reference");
      }
      const title = readStringParam(params, "title", { required: true });
      const summary = readStringParam(params, "summary", { required: true });
      const body = readStringParam(params, "body");
      const why = readStringParam(params, "why");
      const whenToRevisit = readStringParam(params, "whenToRevisit");
      const dedupeKey = readStringParam(params, "dedupeKey");
      const steps = readStringArrayParam(params, "steps");
      const validation = readStringArrayParam(params, "validation");
      const signals = readStringArrayParam(params, "signals");
      const references = readStringArrayParam(params, "references");
      const consequences = readStringArrayParam(params, "consequences");
      const aliases = readStringArrayParam(params, "aliases");
      const tags = readStringArrayParam(params, "tags");

      const note: KnowledgeNoteWriteInput = {
        type,
        title,
        summary,
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

      const guardIssue = classifyKnowledgeNoteGuardIssue(note);
      if (guardIssue) {
        throw new ToolInputError(guardIssue);
      }

      const result = await writeNotebookLmKnowledgeNoteViaCli({
        config: resolved.notebooklm,
        note,
      });

      if (!result) {
        throw new ToolInputError("NotebookLM knowledge write is not configured.");
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
