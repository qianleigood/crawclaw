#!/usr/bin/env node

/**
 * Verifies that the public plugin-sdk subpaths and generated facade types are
 * present in the compiled dist output.
 *
 * Run after `pnpm build` to catch missing subpath artifacts or leaked repo-only
 * type aliases before release.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pluginSdkSubpaths } from "./lib/plugin-sdk-entries.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatedFacadeTypeMapDts = resolve(
  __dirname,
  "..",
  "dist",
  "plugin-sdk",
  "src",
  "generated",
  "plugin-sdk-facade-type-map.generated.d.ts",
);

let missing = 0;
for (const entry of pluginSdkSubpaths) {
  const jsPath = resolve(__dirname, "..", "dist", "plugin-sdk", `${entry}.js`);
  const dtsPath = resolve(__dirname, "..", "dist", "plugin-sdk", `${entry}.d.ts`);
  if (!existsSync(jsPath)) {
    console.error(`MISSING SUBPATH JS: dist/plugin-sdk/${entry}.js`);
    missing += 1;
  }
  if (!existsSync(dtsPath)) {
    console.error(`MISSING SUBPATH DTS: dist/plugin-sdk/${entry}.d.ts`);
    missing += 1;
  }
}

if (!existsSync(generatedFacadeTypeMapDts)) {
  console.error(
    "MISSING GENERATED FACADE TYPE MAP DTS: dist/plugin-sdk/src/generated/plugin-sdk-facade-type-map.generated.d.ts",
  );
  missing += 1;
} else {
  const facadeTypeMapContent = readFileSync(generatedFacadeTypeMapDts, "utf-8");
  if (facadeTypeMapContent.includes("@crawclaw/")) {
    console.error(
      "INVALID GENERATED FACADE TYPE MAP DTS: dist/plugin-sdk/src/generated/plugin-sdk-facade-type-map.generated.d.ts leaks @crawclaw/* imports",
    );
    missing += 1;
  }
}

if (missing > 0) {
  console.error(
    `\nERROR: ${missing} required plugin-sdk artifact(s) missing (named exports or subpath files).`,
  );
  console.error("This will break published plugin-sdk artifacts.");
  console.error("Check generated d.ts rewrites, subpath entries, and rebuild.");
  process.exit(1);
}

console.log(`OK: All ${pluginSdkSubpaths.length} public plugin-sdk subpaths verified.`);
