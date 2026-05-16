import { execFileSync } from "node:child_process";

const JITI_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".mtsx",
  ".ctsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
] as const;

export function loadRuntimeApiExportTypesViaJiti(params: {
  modulePath: string;
  exportNames: readonly string[];
  additionalAliases?: Record<string, string>;
}): Record<string, string> {
  const root = process.cwd();
  const alias = params.additionalAliases ?? {};

  const script = `
import path from "node:path";
import { createJiti } from "jiti";

const modulePath = ${JSON.stringify(params.modulePath)};
const exportNames = ${JSON.stringify(params.exportNames)};
const alias = ${JSON.stringify(alias)};
const jiti = createJiti(path.join(${JSON.stringify(root)}, "package.json"), {
  interopDefault: true,
  tryNative: false,
  fsCache: false,
  moduleCache: false,
  extensions: ${JSON.stringify(JITI_EXTENSIONS)},
  alias,
});
const mod = jiti(modulePath);
console.log(
  JSON.stringify(
    Object.fromEntries(exportNames.map((name) => [name, typeof mod[name]])),
  ),
);
`;

  const raw = execFileSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: root,
    encoding: "utf-8",
  });

  return JSON.parse(raw) as Record<string, string>;
}
