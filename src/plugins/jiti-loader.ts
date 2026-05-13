import { createRequire } from "node:module";

export type CreateJiti = typeof import("jiti").createJiti;
export type JitiLoader = ReturnType<CreateJiti>;

const require = createRequire(import.meta.url);
let createJitiFn: CreateJiti | null = null;

export function loadCreateJiti(): CreateJiti {
  if (!createJitiFn) {
    createJitiFn = (require("jiti") as { createJiti: CreateJiti }).createJiti;
  }
  return createJitiFn;
}

export function createCrawClawJiti(...args: Parameters<CreateJiti>): JitiLoader {
  return loadCreateJiti()(...args);
}
