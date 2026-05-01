import { Type } from "@sinclair/typebox";
import { resolveDurableMemoryScope, type DurableMemoryScope } from "../../memory/durable/scope.ts";
import {
  deleteDurableMemoryNote,
  editDurableMemoryScopedFile,
  readDurableMemoryScopedFile,
  scanDurableMemoryScopeEntries,
  writeDurableMemoryScopedFile,
} from "../../memory/durable/store.ts";
import { jsonResult, readStringParam, ToolInputError, type AnyAgentTool } from "./common.js";

type MemoryFileToolOptions = {
  scope?: {
    agentId?: string | null;
    channel?: string | null;
    userId?: string | null;
  };
  agentId?: string | null;
  channel?: string | null;
  requesterSenderId?: string | null;
};

function resolveScopedMemoryFileToolScope(
  options?: MemoryFileToolOptions,
): DurableMemoryScope | null {
  return resolveDurableMemoryScope({
    agentId: options?.scope?.agentId ?? options?.agentId,
    channel: options?.scope?.channel ?? options?.channel,
    userId: options?.scope?.userId ?? options?.requesterSenderId ?? undefined,
    fallbackToLocal: true,
  });
}

const MemoryManifestReadSchema = Type.Object({
  query: Type.Optional(
    Type.String({ description: "Optional case-insensitive query to filter manifest entries." }),
  ),
  type: Type.Optional(
    Type.String({
      description: "Optional durable type filter: user, feedback, project, or reference.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum manifest entries to return. Defaults to 24." }),
  ),
});

const MemoryNoteReadSchema = Type.Object({
  notePath: Type.String({
    description:
      "Scoped durable memory file path to read, such as MEMORY.md or 60 Preferences/step-first.md.",
  }),
});

const MemoryNoteWriteSchema = Type.Object({
  notePath: Type.String({
    description: "Scoped durable memory file path to write, including MEMORY.md if needed.",
  }),
  content: Type.String({ description: "Complete Markdown content to write to the file." }),
});

const MemoryNoteEditSchema = Type.Object({
  notePath: Type.String({ description: "Scoped durable memory file path to edit." }),
  findText: Type.String({ description: "Exact text to replace." }),
  replaceText: Type.String({ description: "Replacement text." }),
  replaceAll: Type.Optional(
    Type.Boolean({ description: "Replace all occurrences instead of only the first occurrence." }),
  ),
});

const MemoryNoteDeleteSchema = Type.Object({
  notePath: Type.String({ description: "Scoped durable memory file path to delete." }),
});

function normalizeManifestTypeFilter(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized === "user" ||
    normalized === "feedback" ||
    normalized === "project" ||
    normalized === "reference"
    ? normalized
    : undefined;
}

export function createMemoryManifestReadTool(options?: MemoryFileToolOptions): AnyAgentTool | null {
  const scope = resolveScopedMemoryFileToolScope(options);
  if (!scope) {
    return null;
  }
  return {
    label: "Read Memory Manifest",
    name: "memory_manifest_read",
    description:
      "Read the scoped durable memory manifest and current note catalog. Use this first to identify candidate notes before reading or editing specific memory files.",
    parameters: MemoryManifestReadSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query");
      const durableType = normalizeManifestTypeFilter(readStringParam(params, "type"));
      const limitRaw =
        typeof params.limit === "number"
          ? params.limit
          : typeof params.limit === "string"
            ? Number.parseInt(params.limit, 10)
            : Number.NaN;
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : 24;
      const entries = await scanDurableMemoryScopeEntries(scope);
      const filtered = entries
        .filter((entry) => {
          if (durableType && entry.durableType !== durableType) {
            return false;
          }
          if (!query) {
            return true;
          }
          const haystack =
            `${entry.title}\n${entry.description}\n${entry.notePath}\n${entry.dedupeKey ?? ""}`.toLowerCase();
          return haystack.includes(query.toLowerCase());
        })
        .slice(0, limit);
      const index = await readDurableMemoryScopedFile({
        scope,
        notePath: "MEMORY.md",
      }).catch(() => null);
      return jsonResult({
        status: "ok",
        scope,
        entryCount: filtered.length,
        entries: filtered,
        indexText: index?.content ?? null,
      });
    },
  };
}

export function createMemoryNoteReadTool(options?: MemoryFileToolOptions): AnyAgentTool | null {
  const scope = resolveScopedMemoryFileToolScope(options);
  if (!scope) {
    return null;
  }
  return {
    label: "Read Memory Note",
    name: "memory_note_read",
    description: "Read a specific durable memory file inside the current scoped memory directory.",
    parameters: MemoryNoteReadSchema,
    execute: async (_toolCallId, args) => {
      const notePath = readStringParam(args as Record<string, unknown>, "notePath", {
        required: true,
      });
      const result = await readDurableMemoryScopedFile({ scope, notePath });
      return jsonResult({
        status: "ok",
        scope,
        notePath: result.notePath,
        absolutePath: result.absolutePath,
        content: result.content,
      });
    },
  };
}

export function createMemoryNoteWriteTool(options?: MemoryFileToolOptions): AnyAgentTool | null {
  const scope = resolveScopedMemoryFileToolScope(options);
  if (!scope) {
    return null;
  }
  return {
    label: "Write Memory Note",
    name: "memory_note_write",
    description:
      "Write a complete durable memory Markdown file inside the current scoped memory directory.",
    parameters: MemoryNoteWriteSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const notePath = readStringParam(params, "notePath", { required: true });
      const content = readStringParam(params, "content", { required: true, trim: false });
      const result = await writeDurableMemoryScopedFile({
        scope,
        notePath,
        content,
      });
      return jsonResult({
        status: "ok",
        scope,
        notePath: result.notePath,
        absolutePath: result.absolutePath,
        bytesWritten: result.bytesWritten,
        beforeHash: result.beforeHash,
        afterHash: result.afterHash,
      });
    },
  };
}

export function createMemoryNoteEditTool(options?: MemoryFileToolOptions): AnyAgentTool | null {
  const scope = resolveScopedMemoryFileToolScope(options);
  if (!scope) {
    return null;
  }
  return {
    label: "Edit Memory Note",
    name: "memory_note_edit",
    description:
      "Edit a scoped durable memory file by replacing exact text. Use after reading the target file.",
    parameters: MemoryNoteEditSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const notePath = readStringParam(params, "notePath", { required: true });
      const findText = readStringParam(params, "findText", { required: true, trim: false });
      const replaceText = readStringParam(params, "replaceText", { required: true, trim: false });
      const replaceAll = typeof params.replaceAll === "boolean" ? params.replaceAll : false;
      const result = await editDurableMemoryScopedFile({
        scope,
        notePath,
        findText,
        replaceText,
        replaceAll,
      });
      if (result.replacements === 0) {
        throw new ToolInputError("findText not found in target file");
      }
      return jsonResult({
        status: "ok",
        scope,
        notePath: result.notePath,
        absolutePath: result.absolutePath,
        replacements: result.replacements,
        beforeHash: result.beforeHash,
        afterHash: result.afterHash,
        bytesWritten: result.bytesWritten,
      });
    },
  };
}

export function createMemoryNoteDeleteTool(options?: MemoryFileToolOptions): AnyAgentTool | null {
  const scope = resolveScopedMemoryFileToolScope(options);
  if (!scope) {
    return null;
  }
  return {
    label: "Delete Memory Note",
    name: "memory_note_delete",
    description:
      "Delete a scoped durable memory Markdown file. Use for explicit forgetting or invalidated notes.",
    parameters: MemoryNoteDeleteSchema,
    execute: async (_toolCallId, args) => {
      const notePath = readStringParam(args as Record<string, unknown>, "notePath", {
        required: true,
      });
      if (notePath === "MEMORY.md") {
        throw new ToolInputError("Deleting MEMORY.md is not allowed.");
      }
      const result = await deleteDurableMemoryNote({
        scope,
        type: "reference",
        notePath,
      });
      return jsonResult({
        status: result.action === "missing" ? "missing" : "deleted",
        scope,
        notePath: result.notePath,
        indexPath: result.indexPath,
        ...(result.action === "deleted" ? { absolutePath: result.absolutePath } : {}),
      });
    },
  };
}
