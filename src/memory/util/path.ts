import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname } from "node:path";

export function resolveHome(p: string): string {
  return p.replace(/^~/, homedir());
}

export function ensureParentDir(filePath: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
}
