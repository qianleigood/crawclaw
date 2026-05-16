import fs from "node:fs";
import path from "node:path";
import { collectFilesSync, relativeToCwd } from "./check-file-utils.js";

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /["']crawclaw\/plugin-sdk["']/,
    hint: "The JS Plugin SDK was removed; use repo test helpers or the Rust plugin SDK.",
  },
  {
    pattern: /["']crawclaw\/plugin-sdk\/test-utils["']/,
    hint: "The JS Plugin SDK test surface was removed; use test/helpers/plugins/*.",
  },
  {
    pattern: /["']crawclaw\/plugin-sdk\/compat["']/,
    hint: "The JS Plugin SDK compatibility surface was removed.",
  },
  {
    pattern: /["'](?:\.\.\/)+(?:test-utils\/)[^"']+["']/,
    hint: "Use test/helpers/plugins/* for repo-only bundled extension test helpers.",
  },
  {
    pattern: /["'](?:\.\.\/)+(?:src\/test-utils\/)[^"']+["']/,
    hint: "Use test/helpers/plugins/* for repo-only helpers.",
  },
  {
    pattern: /["'](?:\.\.\/)+(?:src\/plugins\/types\.js)["']/,
    hint: "Use test/helpers/plugins/* or a local extension test seam instead.",
  },
];

function isExtensionTestFile(filePath: string): boolean {
  return /\.test\.[cm]?[jt]sx?$/u.test(filePath) || /\.e2e\.test\.[cm]?[jt]sx?$/u.test(filePath);
}

function collectExtensionTestFiles(rootDir: string): string[] {
  return collectFilesSync(rootDir, {
    includeFile: (filePath) => isExtensionTestFile(filePath),
  });
}

function main() {
  const extensionsDir = path.join(process.cwd(), "extensions");
  const files = collectExtensionTestFiles(extensionsDir);
  const offenders: Array<{ file: string; hint: string }> = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    for (const rule of FORBIDDEN_PATTERNS) {
      if (!rule.pattern.test(content)) {
        continue;
      }
      offenders.push({ file, hint: rule.hint });
      break;
    }
  }

  if (offenders.length > 0) {
    console.error("Extension test files must stay on extension test bridges or repo test helpers.");
    for (const offender of offenders.toSorted((a, b) => a.file.localeCompare(b.file))) {
      console.error(`- ${relativeToCwd(offender.file)}: ${offender.hint}`);
    }
    process.exit(1);
  }

  console.log(
    `OK: extension test files avoid direct core test/internal imports (${files.length} checked).`,
  );
}

main();
