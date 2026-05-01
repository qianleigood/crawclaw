import { describe, expect, it } from "vitest";
import { resolveUnifiedEntities } from "./entity-resolver.ts";

describe("resolveUnifiedEntities", () => {
  it("scores NotebookLM experience entities with the experience route bias", () => {
    const result = resolveUnifiedEntities({
      query: "gateway recovery",
      classification: {
        query: "gateway recovery",
        normalizedQuery: "gateway recovery",
        intent: "sop",
        secondaryIntents: [],
        confidence: 0.8,
        keywords: ["gateway", "recovery"],
        entityHints: [],
        temporalHints: [],
        routeWeights: {
          graph: 0.1,
          notebooklm: 0.8,
          nativeMemory: 0.05,
          execution: 0.05,
        },
        targetLayers: ["sop", "sources"],
        rationale: [],
      },
      registries: [
        {
          source: "notebooklm",
          items: [
            {
              id: "notebooklm-gateway-recovery",
              source: "notebooklm",
              title: "gateway recovery",
            },
          ],
        },
      ],
    });

    expect(result.selectedCandidates.map((candidate) => candidate.id)).toEqual([
      "notebooklm-gateway-recovery",
    ]);
  });
});
