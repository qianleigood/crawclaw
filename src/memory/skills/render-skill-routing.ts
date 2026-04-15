import { estimateTokenCount } from "../recall/token-estimate.ts";
import type { SkillRoutingResult } from "../types/orchestration.ts";

export function renderSkillRoutingSection(result: SkillRoutingResult | null | undefined):
  { text: string; estimatedTokens: number } | null {
  if (!result || !result.shortlisted.length) return null;
  const lines = [
    "## Skill routing",
    ...(result.family ? [`- skill_family: ${result.family}`] : []),
    result.supportingSkills.length > 0
      ? "- available_skills is prefiltered to primary and supporting skills for this turn; prefer the primary skill first, then load supporting skills only if the next step needs them."
      : "- available_skills is prefiltered to the most relevant first-pass skills for this turn; if one skill clearly matches, start there.",
  ];
  const text = lines.join("\n");
  return {
    text,
    estimatedTokens: estimateTokenCount(text),
  };
}
