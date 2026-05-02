import {
  INTERNAL_RUNTIME_CONTEXT_BEGIN,
  INTERNAL_RUNTIME_CONTEXT_END,
  stripInternalRuntimeContext,
} from "../agents/internal-runtime-context.js";

function stripInlineInternalRuntimeContextBlocks(text: string): string {
  let next = text;
  for (;;) {
    const start = next.indexOf(INTERNAL_RUNTIME_CONTEXT_BEGIN);
    if (start === -1) {
      return next;
    }
    const end = next.indexOf(
      INTERNAL_RUNTIME_CONTEXT_END,
      start + INTERNAL_RUNTIME_CONTEXT_BEGIN.length,
    );
    const before = next
      .slice(0, start)
      .replace(/\s*\[[^\]\n]*\]\s*$/u, "")
      .trimEnd();
    if (end === -1) {
      return before;
    }
    const after = next.slice(end + INTERNAL_RUNTIME_CONTEXT_END.length).trimStart();
    next = before && after ? `${before}\n\n${after}` : `${before}${after}`;
  }
}

export function stripMemoryInternalRuntimeContext(text: string): string {
  const stripped = stripInternalRuntimeContext(stripInlineInternalRuntimeContextBlocks(text));
  return stripped.replace(/\s+/g, " ").trim();
}
