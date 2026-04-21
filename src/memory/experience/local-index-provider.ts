import { searchExperienceIndexEntries } from "./index-store.ts";
import type { ExperienceProvider, ExperienceSearchInput } from "./provider.ts";

export class LocalExperienceIndexProvider implements ExperienceProvider {
  readonly id = "local_experience_index";

  async search(input: ExperienceSearchInput) {
    if (!input.plan.enabled) {
      return { providerId: this.id, items: [] };
    }
    const items = await searchExperienceIndexEntries({
      query: input.query,
      limit: input.plan.limit,
      targetLayers: input.plan.targetLayers,
    });
    return { providerId: this.id, items };
  }
}
