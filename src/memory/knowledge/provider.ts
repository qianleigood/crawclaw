import type { MemoryRuntimeContext } from "../engine/types.ts";
import type { NotebookLmConfig } from "../types/config.ts";
import type { UnifiedQueryClassification, UnifiedRecallItem } from "../types/orchestration.ts";
import { LocalKnowledgeIndexProvider } from "./local-index-provider.ts";
import { NotebookLmKnowledgeProvider } from "./notebooklm-provider.ts";
import { buildKnowledgeQueryPlan, type KnowledgeQueryPlan } from "./query-plan.ts";

export type KnowledgeRuntimeLogger = {
  warn(message: string): void;
};

export interface KnowledgeSearchInput {
  query: string;
  classification: UnifiedQueryClassification;
  recentMessages?: string[];
  runtimeContext?: MemoryRuntimeContext;
  plan: KnowledgeQueryPlan;
}

export interface KnowledgeProviderSearchResult {
  providerId: string;
  items: UnifiedRecallItem[];
}

export interface KnowledgeProvider {
  readonly id: string;
  search(input: KnowledgeSearchInput): Promise<KnowledgeProviderSearchResult>;
}

export interface KnowledgeRecallResult {
  items: UnifiedRecallItem[];
  queryPlan: KnowledgeQueryPlan;
  providerIds: string[];
}

export class KnowledgeProviderRegistry {
  constructor(
    private readonly providers: readonly KnowledgeProvider[],
    private readonly options: {
      defaultLimit: number;
      logger: KnowledgeRuntimeLogger;
    },
  ) {}

  getProviderIds(): string[] {
    return this.providers.map((provider) => provider.id);
  }

  async search(input: {
    query: string;
    classification: UnifiedQueryClassification;
    recentMessages?: string[];
    runtimeContext?: MemoryRuntimeContext;
  }): Promise<KnowledgeRecallResult> {
    const providerIds = this.getProviderIds();
    const queryPlan = buildKnowledgeQueryPlan({
      query: input.query,
      classification: input.classification,
      defaultLimit: this.options.defaultLimit,
      providerIds,
    });
    if (!queryPlan.enabled || queryPlan.limit <= 0 || queryPlan.providerIds.length === 0) {
      return {
        items: [],
        queryPlan,
        providerIds: [],
      };
    }

    const plannedProviderIds = new Set(queryPlan.providerIds);
    const providerResults = await Promise.all(
      this.providers
        .filter((provider) => plannedProviderIds.has(provider.id))
        .map((provider) =>
          provider
            .search({
              ...input,
              plan: queryPlan,
            })
            .catch((error) => {
              this.options.logger.warn(
                `[memory] knowledge provider ${provider.id} skipped | ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
              return { providerId: provider.id, items: [] };
            }),
        ),
    );
    return {
      items: providerResults.flatMap((result) => result.items),
      queryPlan,
      providerIds: providerResults
        .filter((result) => result.items.length > 0 || plannedProviderIds.has(result.providerId))
        .map((result) => result.providerId),
    };
  }
}

export function createDefaultKnowledgeProviderRegistry(options: {
  notebooklm?: NotebookLmConfig;
  logger: KnowledgeRuntimeLogger;
}): KnowledgeProviderRegistry {
  return new KnowledgeProviderRegistry(
    [
      new NotebookLmKnowledgeProvider({
        config: options.notebooklm,
        logger: options.logger,
      }),
      new LocalKnowledgeIndexProvider(),
    ],
    {
      defaultLimit: options.notebooklm?.cli.limit ?? 5,
      logger: options.logger,
    },
  );
}
