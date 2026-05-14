#!/usr/bin/env node

import ts from "typescript";
import { bundledPluginCallsite } from "./lib/bundled-plugin-paths.mjs";
import { runCallsiteGuard } from "./lib/callsite-guard.mjs";
import {
  collectCallExpressionLines,
  runAsScript,
  unwrapExpression,
} from "./lib/ts-guard-utils.mjs";

const sourceRoots = ["src/channels", "src/routing", "extensions"];

// Temporary allowlist for legacy callsites. New raw fetch callsites in channel/plugin runtime
// code should be rejected and migrated to fetchWithSsrFGuard/shared channel helpers.
const allowedRawFetchCallsites = new Set([
  bundledPluginCallsite("feishu", "src/streaming-card.ts", 31),
  bundledPluginCallsite("feishu", "src/streaming-card.ts", 101),
  bundledPluginCallsite("feishu", "src/streaming-card.ts", 143),
  bundledPluginCallsite("feishu", "src/streaming-card.ts", 199),
  bundledPluginCallsite("minimax", "oauth.ts", 62),
  bundledPluginCallsite("minimax", "oauth.ts", 93),
  bundledPluginCallsite("talk-voice", "index.ts", 27),
  bundledPluginCallsite("voice-call", "src/providers/plivo.ts", 95),
  bundledPluginCallsite("voice-call", "src/providers/telnyx.ts", 61),
  bundledPluginCallsite("voice-call", "src/providers/tts-openai.ts", 111),
  bundledPluginCallsite("voice-call", "src/providers/twilio/api.ts", 23),
]);

function isRawFetchCall(expression) {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) {
    return callee.text === "fetch";
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return (
      ts.isIdentifier(callee.expression) &&
      callee.expression.text === "globalThis" &&
      callee.name.text === "fetch"
    );
  }
  return false;
}

export function findRawFetchCallLines(content, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  return collectCallExpressionLines(ts, sourceFile, (node) =>
    isRawFetchCall(node.expression) ? node.expression : null,
  );
}

export async function main() {
  await runCallsiteGuard({
    importMetaUrl: import.meta.url,
    sourceRoots,
    extraTestSuffixes: [".browser.test.ts", ".node.test.ts"],
    findCallLines: findRawFetchCallLines,
    allowCallsite: (callsite) => allowedRawFetchCallsites.has(callsite),
    header: "Found raw fetch() usage in channel/plugin runtime sources outside allowlist:",
    footer: "Use fetchWithSsrFGuard() or existing channel/plugin SDK wrappers for network calls.",
  });
}

runAsScript(import.meta.url, main);
