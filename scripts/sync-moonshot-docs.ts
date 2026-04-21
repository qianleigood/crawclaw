import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOONSHOT_KIMI_K2_CONTEXT_WINDOW = 256000;
const MOONSHOT_KIMI_K2_MAX_TOKENS = 8192;
const MOONSHOT_KIMI_K2_INPUT = ["text"] as const;
const MOONSHOT_KIMI_K2_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;
const MOONSHOT_KIMI_K2_MODELS = [
  { id: "kimi-k2.5", alias: "Kimi K2.5", name: "Kimi K2.5", reasoning: false },
  {
    id: "kimi-k2-0905-preview",
    alias: "Kimi K2",
    name: "Kimi K2 0905 Preview",
    reasoning: false,
  },
  {
    id: "kimi-k2-turbo-preview",
    alias: "Kimi K2 Turbo",
    name: "Kimi K2 Turbo",
    reasoning: false,
  },
  {
    id: "kimi-k2-thinking",
    alias: "Kimi K2 Thinking",
    name: "Kimi K2 Thinking",
    reasoning: true,
  },
  {
    id: "kimi-k2-thinking-turbo",
    alias: "Kimi K2 Thinking Turbo",
    name: "Kimi K2 Thinking Turbo",
    reasoning: true,
  },
] as const;

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

function replaceBlockLines(
  text: string,
  startMarker: string,
  endMarker: string,
  lines: string[],
): string {
  const startIndex = text.indexOf(startMarker);
  if (startIndex === -1) {
    throw new Error(`Missing start marker: ${startMarker}`);
  }
  const endIndex = text.indexOf(endMarker, startIndex);
  if (endIndex === -1) {
    throw new Error(`Missing end marker: ${endMarker}`);
  }

  const startLineStart = text.lastIndexOf("\n", startIndex);
  const startLineStartIndex = startLineStart === -1 ? 0 : startLineStart + 1;
  const indent = text.slice(startLineStartIndex, startIndex);

  const endLineEnd = text.indexOf("\n", endIndex);
  const endLineEndIndex = endLineEnd === -1 ? text.length : endLineEnd + 1;

  const before = text.slice(0, startLineStartIndex);
  const after = text.slice(endLineEndIndex);

  const replacementLines = [
    `${indent}${startMarker}`,
    ...lines.map((line) => `${indent}${line}`),
    `${indent}${endMarker}`,
  ];

  const replacement = replacementLines.join("\n");
  if (!after) {
    return `${before}${replacement}`;
  }
  return `${before}${replacement}\n${after}`;
}

function renderKimiK2Ids(prefix: string) {
  return [...MOONSHOT_KIMI_K2_MODELS.map((model) => `- \`${prefix}${model.id}\``), ""];
}

function renderMoonshotAliases() {
  return MOONSHOT_KIMI_K2_MODELS.map((model, index) => {
    const isLast = index === MOONSHOT_KIMI_K2_MODELS.length - 1;
    const suffix = isLast ? "" : ",";
    return `"moonshot/${model.id}": { alias: "${model.alias}" }${suffix}`;
  });
}

function renderMoonshotModels() {
  const input = JSON.stringify([...MOONSHOT_KIMI_K2_INPUT]);
  const cost = `input: ${MOONSHOT_KIMI_K2_COST.input}, output: ${MOONSHOT_KIMI_K2_COST.output}, cacheRead: ${MOONSHOT_KIMI_K2_COST.cacheRead}, cacheWrite: ${MOONSHOT_KIMI_K2_COST.cacheWrite}`;

  return MOONSHOT_KIMI_K2_MODELS.flatMap((model, index) => {
    const isLast = index === MOONSHOT_KIMI_K2_MODELS.length - 1;
    const closing = isLast ? "}" : "},";
    return [
      "{",
      `  id: "${model.id}",`,
      `  name: "${model.name}",`,
      `  reasoning: ${model.reasoning},`,
      `  input: ${input},`,
      `  cost: { ${cost} },`,
      `  contextWindow: ${MOONSHOT_KIMI_K2_CONTEXT_WINDOW},`,
      `  maxTokens: ${MOONSHOT_KIMI_K2_MAX_TOKENS}`,
      closing,
    ];
  });
}

async function syncMoonshotDocs() {
  const moonshotDoc = path.join(repoRoot, "docs/providers/moonshot.md");
  const conceptsDoc = path.join(repoRoot, "docs/concepts/model-providers.md");

  let moonshotText = await readFile(moonshotDoc, "utf8");
  moonshotText = replaceBlockLines(
    moonshotText,
    '[//]: # "moonshot-kimi-k2-ids:start"',
    '[//]: # "moonshot-kimi-k2-ids:end"',
    renderKimiK2Ids(""),
  );
  moonshotText = replaceBlockLines(
    moonshotText,
    "// moonshot-kimi-k2-aliases:start",
    "// moonshot-kimi-k2-aliases:end",
    renderMoonshotAliases(),
  );
  moonshotText = replaceBlockLines(
    moonshotText,
    "// moonshot-kimi-k2-models:start",
    "// moonshot-kimi-k2-models:end",
    renderMoonshotModels(),
  );

  let conceptsText = await readFile(conceptsDoc, "utf8");
  conceptsText = replaceBlockLines(
    conceptsText,
    '[//]: # "moonshot-kimi-k2-model-refs:start"',
    '[//]: # "moonshot-kimi-k2-model-refs:end"',
    renderKimiK2Ids("moonshot/"),
  );

  await writeFile(moonshotDoc, moonshotText);
  await writeFile(conceptsDoc, conceptsText);
}

syncMoonshotDocs().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
