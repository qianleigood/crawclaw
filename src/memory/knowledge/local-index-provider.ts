import { searchKnowledgeIndexEntries } from "./index-store.ts";
import type { KnowledgeProvider, KnowledgeSearchInput } from "./provider.ts";

export class LocalKnowledgeIndexProvider implements KnowledgeProvider {
  readonly id = "local_knowledge_index";

  async search(input: KnowledgeSearchInput) {
    if (!input.plan.enabled) {
      return { providerId: this.id, items: [] };
    }
    const items = await searchKnowledgeIndexEntries({
      query: input.query,
      limit: input.plan.limit,
      targetLayers: input.plan.targetLayers,
    });
    return { providerId: this.id, items };
  }
}
