#!/usr/bin/env node

import ts from "typescript";
import {
  collectTypeScriptInventory,
  normalizeRepoPath,
  resolveRepoSpecifier,
  visitModuleSpecifiers,
  writeLine,
} from "./lib/guard-inventory-utils.mjs";
import {
  collectTypeScriptFilesFromRoots,
  resolveRepoRoot,
  resolveSourceRoots,
  runAsScript,
  toLine,
} from "./lib/ts-guard-utils.mjs";

const repoRoot = resolveRepoRoot(import.meta.url);
const scanRoots = resolveSourceRoots(repoRoot, ["src/agents", "src/auto-reply"]);

const AGENT_GATEWAY_ALLOWED_IMPORTS = new Set([
  "src/gateway/agent-list.js",
  "src/gateway/call.js",
  "src/gateway/credentials.js",
  "src/gateway/method-scopes.js",
  "src/gateway/protocol/client-info.js",
  "src/gateway/session-utils.fs.js",
  "src/gateway/session-utils.js",
]);

const AUTO_REPLY_CHANNEL_ALLOWED_IMPORTS = new Set([
  "src/channels/chat-type.js",
  "src/channels/conversation-binding-context.js",
  "src/channels/conversation-label.js",
  "src/channels/model-overrides.js",
  "src/channels/plugins/binding-registry.js",
  "src/channels/plugins/binding-targets.js",
  "src/channels/plugins/config-writes.js",
  "src/channels/plugins/exec-approval-local.js",
  "src/channels/plugins/index.js",
  "src/channels/plugins/session-conversation.js",
  "src/channels/plugins/target-parsing.js",
  "src/channels/plugins/types.js",
  "src/channels/registry.js",
  "src/channels/sender-label.js",
  "src/channels/thread-bindings-messages.js",
  "src/channels/thread-bindings-policy.js",
  "src/channels/typing-lifecycle.js",
  "src/channels/typing-start-guard.js",
  "src/channels/typing.js",
]);

function compareEntries(left, right) {
  return (
    left.boundary.localeCompare(right.boundary) ||
    left.file.localeCompare(right.file) ||
    left.line - right.line ||
    left.kind.localeCompare(right.kind) ||
    left.specifier.localeCompare(right.specifier) ||
    left.resolvedPath.localeCompare(right.resolvedPath) ||
    left.reason.localeCompare(right.reason)
  );
}

function shouldSkipFile(filePath) {
  const relativeFile = normalizeRepoPath(repoRoot, filePath);
  return (
    relativeFile.includes("/test-helpers/") ||
    relativeFile.includes("/fixtures/") ||
    relativeFile.includes("/__tests__/") ||
    relativeFile.endsWith(".spec.ts") ||
    relativeFile.includes(".fixture.") ||
    relativeFile.includes(".snap.")
  );
}

function pushEntry(entries, entry) {
  entries.push(entry);
}

function collectEntriesForFile(sourceFile, filePath) {
  const entries = [];
  const relativeFile = normalizeRepoPath(repoRoot, filePath);

  visitModuleSpecifiers(ts, sourceFile, ({ kind, specifier, specifierNode }) => {
    const resolvedPath = resolveRepoSpecifier(repoRoot, specifier, filePath);
    if (!resolvedPath) {
      return;
    }

    if (relativeFile.startsWith("src/agents/") && resolvedPath.startsWith("src/gateway/")) {
      if (!AGENT_GATEWAY_ALLOWED_IMPORTS.has(resolvedPath)) {
        pushEntry(entries, {
          boundary: "agents->gateway",
          file: relativeFile,
          line: toLine(sourceFile, specifierNode),
          kind,
          specifier,
          resolvedPath,
          reason: `imports gateway internal "${resolvedPath}" outside the approved agent runtime seam`,
        });
      }
      return;
    }

    if (relativeFile.startsWith("src/auto-reply/") && resolvedPath.startsWith("src/channels/")) {
      if (!AUTO_REPLY_CHANNEL_ALLOWED_IMPORTS.has(resolvedPath)) {
        pushEntry(entries, {
          boundary: "auto-reply->channels",
          file: relativeFile,
          line: toLine(sourceFile, specifierNode),
          kind,
          specifier,
          resolvedPath,
          reason: `imports channel internal "${resolvedPath}" outside the approved auto-reply interaction seam`,
        });
      }
    }
  });

  return entries;
}

export async function collectRuntimeModuleBoundaryInventory() {
  const files = (
    await collectTypeScriptFilesFromRoots(scanRoots, { extraTestSuffixes: [".spec.ts"] })
  )
    .filter((filePath) => !shouldSkipFile(filePath))
    .toSorted((left, right) =>
      normalizeRepoPath(repoRoot, left).localeCompare(normalizeRepoPath(repoRoot, right)),
    );

  return await collectTypeScriptInventory({
    ts,
    files,
    compareEntries,
    collectEntries(sourceFile, filePath) {
      return collectEntriesForFile(sourceFile, filePath);
    },
  });
}

function formatInventoryHuman(inventory) {
  if (inventory.length === 0) {
    return [
      "Rule: src/agents/** may only import approved gateway runtime seams",
      "Rule: src/auto-reply/** may only import approved channel interaction seams",
      "No runtime module boundary violations found.",
    ].join("\n");
  }

  const lines = [
    "Rule: src/agents/** may only import approved gateway runtime seams",
    "Rule: src/auto-reply/** may only import approved channel interaction seams",
    "Runtime module boundary violations:",
  ];
  let activeFile = "";
  for (const entry of inventory) {
    if (entry.file !== activeFile) {
      activeFile = entry.file;
      lines.push(activeFile);
    }
    lines.push(`  - line ${entry.line} [${entry.boundary}/${entry.kind}] ${entry.reason}`);
    lines.push(`    specifier: ${entry.specifier}`);
    lines.push(`    resolved: ${entry.resolvedPath}`);
  }
  return lines.join("\n");
}

function formatEntry(entry) {
  return `${entry.file}:${entry.line} [${entry.boundary}/${entry.kind}] ${entry.reason} (${entry.specifier} -> ${entry.resolvedPath})`;
}

export async function main(argv = process.argv.slice(2), io) {
  const streams = io ?? { stdout: process.stdout, stderr: process.stderr };
  const json = argv.includes("--json");
  const inventory = await collectRuntimeModuleBoundaryInventory();

  if (json) {
    writeLine(streams.stdout, JSON.stringify(inventory, null, 2));
    return inventory.length === 0 ? 0 : 1;
  }

  writeLine(streams.stdout, formatInventoryHuman(inventory));
  if (inventory.length > 0) {
    writeLine(streams.stderr, "Unexpected entries:");
    for (const entry of inventory) {
      writeLine(streams.stderr, `- ${formatEntry(entry)}`);
    }
  }
  return inventory.length === 0 ? 0 : 1;
}

runAsScript(import.meta.url, async (argv = process.argv.slice(2), io) => {
  const exitCode = await main(argv, io);
  if (!io && exitCode !== 0) {
    process.exit(exitCode);
  }
  return exitCode;
});
