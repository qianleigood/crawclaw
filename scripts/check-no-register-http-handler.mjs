#!/usr/bin/env node

import ts from "typescript";
import { runCallsiteGuard } from "./lib/callsite-guard.mjs";
import {
  collectCallExpressionLines,
  runAsScript,
  unwrapExpression,
} from "./lib/ts-guard-utils.mjs";

const sourceRoots = ["src", "extensions"];

function isDeprecatedRegisterHttpHandlerCall(expression) {
  const callee = unwrapExpression(expression);
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "registerHttpHandler";
}

export function findDeprecatedRegisterHttpHandlerLines(content, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  return collectCallExpressionLines(ts, sourceFile, (node) =>
    isDeprecatedRegisterHttpHandlerCall(node.expression) ? node.expression : null,
  );
}

export async function main() {
  await runCallsiteGuard({
    importMetaUrl: import.meta.url,
    sourceRoots,
    findCallLines: findDeprecatedRegisterHttpHandlerLines,
    header: "Found deprecated plugin API call registerHttpHandler(...):",
    footer:
      "TypeScript plugins cannot register HTTP handlers; move production routes to Rust Gateway/native runtime.",
  });
}

runAsScript(import.meta.url, main);
