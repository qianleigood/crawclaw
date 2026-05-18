import { z } from "zod";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { ConfigUiHints } from "../shared/config-ui-hints-types.js";
import {
  isSensitiveUrlConfigPath,
  SENSITIVE_URL_HINT_TAG,
} from "../shared/net/redact-sensitive-url.js";
import { sensitive } from "./zod-schema.sensitive.js";

let log: ReturnType<typeof createSubsystemLogger> | null = null;

function getLog(): ReturnType<typeof createSubsystemLogger> {
  if (!log) {
    log = createSubsystemLogger("config/schema");
  }
  return log;
}

export type { ConfigUiHint, ConfigUiHints } from "../shared/config-ui-hints-types.js";

/**
 * Non-sensitive field names that happen to match sensitive patterns.
 * These are explicitly excluded from redaction (plugin config) and
 * warnings about not being marked sensitive (base config).
 */
const SENSITIVE_KEY_WHITELIST_SUFFIXES = [
  "maxtokens",
  "maxoutputtokens",
  "maxinputtokens",
  "maxcompletiontokens",
  "contexttokens",
  "totaltokens",
  "tokencount",
  "tokenlimit",
  "tokenbudget",
  "passwordFile",
] as const;
const NORMALIZED_SENSITIVE_KEY_WHITELIST_SUFFIXES = SENSITIVE_KEY_WHITELIST_SUFFIXES.map((suffix) =>
  suffix.toLowerCase(),
);

const SENSITIVE_PATTERNS = [
  /token$/i,
  /password/i,
  /secret/i,
  /api.?key/i,
  /encrypt.?key/i,
  /private.?key/i,
  /serviceaccount(?:ref)?$/i,
];

function isWhitelistedSensitivePath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return NORMALIZED_SENSITIVE_KEY_WHITELIST_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix));
}

function matchesSensitivePattern(path: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(path));
}

export function isSensitiveConfigPath(path: string): boolean {
  return !isWhitelistedSensitivePath(path) && matchesSensitivePattern(path);
}

export function applySensitiveHints(
  hints: ConfigUiHints,
  allowedKeys?: ReadonlySet<string>,
): ConfigUiHints {
  const next = { ...hints };
  const keys = allowedKeys ? [...allowedKeys] : Object.keys(next);
  for (const key of keys) {
    const current = next[key];
    if (current?.sensitive !== undefined) {
      continue;
    }
    if (isSensitiveConfigPath(key)) {
      next[key] = { ...current, sensitive: true };
    }
  }
  return next;
}

export function applySensitiveUrlHints(
  hints: ConfigUiHints,
  allowedKeys?: ReadonlySet<string>,
): ConfigUiHints {
  const next = { ...hints };
  const keys = allowedKeys ? [...allowedKeys] : Object.keys(next);
  for (const key of keys) {
    if (!isSensitiveUrlConfigPath(key)) {
      continue;
    }
    const current = next[key];
    const tags = new Set(current?.tags ?? []);
    tags.add(SENSITIVE_URL_HINT_TAG);
    next[key] = {
      ...current,
      tags: [...tags],
    };
  }
  return next;
}

export function collectMatchingSchemaPaths(
  schema: z.ZodType,
  path: string,
  matchesPath: (path: string) => boolean,
  paths: Set<string> = new Set(),
): Set<string> {
  let currentSchema = schema;

  while (isUnwrappable(currentSchema)) {
    currentSchema = currentSchema.unwrap();
  }

  if (path && matchesPath(path)) {
    paths.add(path);
  }

  if (currentSchema instanceof z.ZodObject) {
    const shape = currentSchema.shape;
    for (const key in shape) {
      const nextPath = path ? `${path}.${key}` : key;
      collectMatchingSchemaPaths(shape[key], nextPath, matchesPath, paths);
    }
    const catchallSchema = currentSchema._def.catchall as z.ZodType | undefined;
    if (catchallSchema && !(catchallSchema instanceof z.ZodNever)) {
      const nextPath = path ? `${path}.*` : "*";
      collectMatchingSchemaPaths(catchallSchema, nextPath, matchesPath, paths);
    }
  } else if (currentSchema instanceof z.ZodArray) {
    const nextPath = path ? `${path}[]` : "[]";
    collectMatchingSchemaPaths(currentSchema.element as z.ZodType, nextPath, matchesPath, paths);
  } else if (currentSchema instanceof z.ZodRecord) {
    const nextPath = path ? `${path}.*` : "*";
    collectMatchingSchemaPaths(
      currentSchema._def.valueType as z.ZodType,
      nextPath,
      matchesPath,
      paths,
    );
  } else if (
    currentSchema instanceof z.ZodUnion ||
    currentSchema instanceof z.ZodDiscriminatedUnion
  ) {
    for (const option of currentSchema.options) {
      collectMatchingSchemaPaths(option as z.ZodType, path, matchesPath, paths);
    }
  } else if (currentSchema instanceof z.ZodIntersection) {
    collectMatchingSchemaPaths(currentSchema._def.left as z.ZodType, path, matchesPath, paths);
    collectMatchingSchemaPaths(currentSchema._def.right as z.ZodType, path, matchesPath, paths);
  }

  return paths;
}

// Seems to be the only way tsgo accepts us to check if we have a ZodClass
// with an unwrap() method. And it's overly complex because oxlint and
// tsgo are each forbidding what the other allows.
interface ZodDummy {
  unwrap: () => z.ZodType;
}
function isUnwrappable(object: unknown): object is ZodDummy {
  return (
    !!object &&
    typeof object === "object" &&
    "unwrap" in object &&
    typeof (object as Record<string, unknown>).unwrap === "function" &&
    !(object instanceof z.ZodArray)
  );
}

export function mapSensitivePaths(
  schema: z.ZodType,
  path: string,
  hints: ConfigUiHints,
): ConfigUiHints {
  let next = { ...hints };
  let currentSchema = schema;
  let isSensitive = sensitive.has(currentSchema);

  while (isUnwrappable(currentSchema)) {
    currentSchema = currentSchema.unwrap();
    isSensitive ||= sensitive.has(currentSchema);
  }

  if (isSensitive) {
    next[path] = { ...next[path], sensitive: true };
  } else if (isSensitiveConfigPath(path) && !next[path]?.sensitive) {
    getLog().debug(`possibly sensitive key found: (${path})`);
  }

  if (currentSchema instanceof z.ZodObject) {
    const shape = currentSchema.shape;
    for (const key in shape) {
      const nextPath = path ? `${path}.${key}` : key;
      next = mapSensitivePaths(shape[key], nextPath, next);
    }
    const catchallSchema = currentSchema._def.catchall as z.ZodType | undefined;
    if (catchallSchema && !(catchallSchema instanceof z.ZodNever)) {
      const nextPath = path ? `${path}.*` : "*";
      next = mapSensitivePaths(catchallSchema, nextPath, next);
    }
  } else if (currentSchema instanceof z.ZodArray) {
    const nextPath = path ? `${path}[]` : "[]";
    next = mapSensitivePaths(currentSchema.element as z.ZodType, nextPath, next);
  } else if (currentSchema instanceof z.ZodRecord) {
    const nextPath = path ? `${path}.*` : "*";
    next = mapSensitivePaths(currentSchema._def.valueType as z.ZodType, nextPath, next);
  } else if (
    currentSchema instanceof z.ZodUnion ||
    currentSchema instanceof z.ZodDiscriminatedUnion
  ) {
    for (const option of currentSchema.options) {
      next = mapSensitivePaths(option as z.ZodType, path, next);
    }
  } else if (currentSchema instanceof z.ZodIntersection) {
    next = mapSensitivePaths(currentSchema._def.left as z.ZodType, path, next);
    next = mapSensitivePaths(currentSchema._def.right as z.ZodType, path, next);
  }

  return next;
}

/** @internal */
export const __test__ = {
  collectMatchingSchemaPaths,
  mapSensitivePaths,
};
