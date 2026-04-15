import { randomUUID, createHash } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function stableHash(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
