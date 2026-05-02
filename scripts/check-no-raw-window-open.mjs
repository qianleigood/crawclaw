#!/usr/bin/env node

import ts from "typescript";
import { runCallsiteGuard } from "./lib/callsite-guard.mjs";
import {
  collectCallExpressionLines,
  runAsScript,
  unwrapExpression,
} from "./lib/ts-guard-utils.mjs";

const sourceRoots = ["src", "extensions"];

function isRawWindowOpenCall(expression) {
  const callee = unwrapExpression(expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "open") {
    return false;
  }
  const owner = unwrapExpression(callee.expression);
  return ts.isIdentifier(owner) && (owner.text === "window" || owner.text === "globalThis");
}

export function findRawWindowOpenLines(content, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  return collectCallExpressionLines(ts, sourceFile, (node) =>
    isRawWindowOpenCall(node.expression) ? node.expression : null,
  );
}

export async function main() {
  await runCallsiteGuard({
    importMetaUrl: import.meta.url,
    sourceRoots,
    findCallLines: findRawWindowOpenLines,
    header: "Found raw window.open() usage outside allowlist:",
    footer: "Use a reviewed navigation helper so new windows keep the expected safety options.",
  });
}

runAsScript(import.meta.url, main);
