import { getModel, type Api, type Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../config/config.js";
import { resolveCrawClawAgentDir } from "../agent-paths.js";
import { collectProviderApiKeys } from "../live-auth-keys.js";
import { isHighSignalLiveModelRef } from "../live-model-filter.js";
import { isLiveTestEnabled } from "../live-test-helpers.js";
import { ensureAuthProfileStore, getApiKeyForModel } from "../model-auth.js";
import { shouldSuppressBuiltInModel } from "../model-suppression.js";
import { ensureCrawClawModelsJson } from "../models-config.js";
import { discoverAuthStorage, discoverModels } from "../pi-model-discovery.js";
import { createModelSkillDiscoveryReranker } from "./discovery-reranker.js";
import { discoverSkillsForTask, type SkillDiscoveryCandidate } from "./discovery.js";

type LiveSkillDiscoveryModel = {
  model: Model<Api>;
  apiKey: string;
  source: string;
};
type StaticLiveSkillDiscoveryProvider = "openai" | "anthropic" | "google";

const LIVE = isLiveTestEnabled(["CRAWCLAW_LIVE_SKILL_DISCOVERY"]);
const PROVIDER_PRIORITY = [
  "openai",
  "openai-codex",
  "anthropic",
  "google",
  "google-gemini-cli",
  "minimax",
  "minimax-portal",
] as const;
const MODEL_PRIORITY = ["gpt-5.4-mini", "gpt-5.4", "gpt-5.2", "claude-sonnet-4-6"] as const;

const CANDIDATE_SKILLS: SkillDiscoveryCandidate[] = [
  {
    name: "release-risk",
    description:
      "Use when reviewing release readiness, deployment gates, rollback plans, and launch risk.",
    location: "/tmp/crawclaw-skills/release-risk/SKILL.md",
  },
  {
    name: "slack-update",
    description: "Use when drafting or sending Slack updates to teammates after engineering work.",
    location: "/tmp/crawclaw-skills/slack-update/SKILL.md",
  },
  {
    name: "ci-fix",
    description: "Use when diagnosing failing CI checks, flaky tests, and build logs.",
    location: "/tmp/crawclaw-skills/ci-fix/SKILL.md",
  },
];

function resolveStaticLiveModelChoices(): Model<Api>[] {
  const choices: Array<{ provider: StaticLiveSkillDiscoveryProvider; modelId: string }> = [
    {
      provider: "openai",
      modelId: process.env.CRAWCLAW_LIVE_SKILL_DISCOVERY_OPENAI_MODEL ?? "gpt-5.4",
    },
    {
      provider: "anthropic",
      modelId: process.env.CRAWCLAW_LIVE_SKILL_DISCOVERY_ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    },
    {
      provider: "google",
      modelId: process.env.CRAWCLAW_LIVE_SKILL_DISCOVERY_GOOGLE_MODEL ?? "gemini-2.5-flash",
    },
  ];
  return choices
    .map((choice) => getModel(choice.provider, choice.modelId as never) as Model<Api> | undefined)
    .filter((model): model is Model<Api> => Boolean(model));
}

function isLocalModelEndpoint(model: Model<Api>): boolean {
  const baseUrl = model.baseUrl?.trim();
  if (!baseUrl) {
    return false;
  }
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

function modelSelectionPriority(model: Model<Api>): number {
  const providerIndex = PROVIDER_PRIORITY.indexOf(
    model.provider as (typeof PROVIDER_PRIORITY)[number],
  );
  const modelIndex = MODEL_PRIORITY.indexOf(model.id as (typeof MODEL_PRIORITY)[number]);
  return (
    (providerIndex === -1 ? PROVIDER_PRIORITY.length : providerIndex) * 100 +
    (modelIndex === -1 ? MODEL_PRIORITY.length : modelIndex)
  );
}

async function resolveRegistryLiveModelChoices(): Promise<Model<Api>[]> {
  const agentDir = resolveCrawClawAgentDir();
  const cfg = await loadConfig();
  await ensureCrawClawModelsJson(cfg);
  const authStorage = discoverAuthStorage(agentDir);
  const registry = discoverModels(authStorage, agentDir);
  const models = registry
    .getAll()
    .filter(
      (model: Model<Api>) =>
        !shouldSuppressBuiltInModel({ provider: model.provider, id: model.id }) &&
        !isLocalModelEndpoint(model),
    );
  const highSignal = models.filter((model: Model<Api>) =>
    isHighSignalLiveModelRef({ provider: model.provider, id: model.id }),
  );
  return [...highSignal, ...models].sort(
    (left, right) => modelSelectionPriority(left) - modelSelectionPriority(right),
  );
}

function uniqueModels(models: Model<Api>[]): Model<Api>[] {
  const seen = new Set<string>();
  const unique: Model<Api>[] = [];
  for (const model of models) {
    const key = `${model.provider}/${model.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(model);
  }
  return unique;
}

async function resolveLiveSkillDiscoveryModel(): Promise<LiveSkillDiscoveryModel | undefined> {
  const cfg = await loadConfig();
  const agentDir = resolveCrawClawAgentDir();
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  const models = uniqueModels([
    ...resolveStaticLiveModelChoices(),
    ...(await resolveRegistryLiveModelChoices()),
  ]);

  for (const model of models) {
    const apiKey = collectProviderApiKeys(model.provider)[0];
    if (apiKey) {
      return { model, apiKey, source: "env" };
    }

    try {
      const auth = await getApiKeyForModel({ model, cfg, store, agentDir });
      if (!auth.apiKey || auth.source.includes("synthetic local key")) {
        continue;
      }
      return { model, apiKey: auth.apiKey, source: auth.source };
    } catch {
      continue;
    }
  }

  return undefined;
}

const describeLive = LIVE ? describe : describe.skip;

describeLive("skill discovery reranker live", () => {
  it("selects release readiness from a multilingual task using a real provider model", async () => {
    const selected = await resolveLiveSkillDiscoveryModel();
    if (!selected) {
      process.stderr.write("[live] skill discovery reranker: no live provider credentials found\n");
      return;
    }
    process.stderr.write(
      `[live] skill discovery reranker: ${selected.model.provider}/${selected.model.id} (${selected.source})\n`,
    );

    const result = await discoverSkillsForTask({
      taskDescription:
        "上线前做 release readiness and launch risk review，确认门禁和回滚预案，不要写 Slack 更新。",
      availableSkills: CANDIDATE_SKILLS,
      limit: 1,
      signal: "turn_zero",
      rerank: createModelSkillDiscoveryReranker({
        model: selected.model,
        authStorage: {
          getApiKey: async (provider) =>
            provider === selected.model.provider ? selected.apiKey : undefined,
        },
        maxTokens: 192,
      }),
    });

    expect(result.skills.map((skill) => skill.name)).toEqual(["release-risk"]);
    expect(result.source).not.toBe("native");
  }, 45_000);
});
