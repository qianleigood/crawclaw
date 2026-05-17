/**
 * Build an import URL for a hook handler module.
 *
 * Workspace, managed, and plugin hooks may be edited by the user between
 * restarts. For those we append `?t=<mtime>&s=<size>` so the module key
 * reflects on-disk changes while staying stable for unchanged files.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import type { HookSource } from "./types.js";

export function buildImportUrl(handlerPath: string, source: HookSource): string {
  const base = pathToFileURL(handlerPath).href;
  void source;

  // Use file metadata so the cache key only changes when the file changes
  try {
    const { mtimeMs, size } = fs.statSync(handlerPath);
    return `${base}?t=${mtimeMs}&s=${size}`;
  } catch {
    // If stat fails (unlikely), fall back to Date.now() to guarantee freshness
    return `${base}?t=${Date.now()}`;
  }
}
