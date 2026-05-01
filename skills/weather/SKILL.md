---
name: weather
description: Use when the user asks for current weather, rain, temperature, conditions, or short forecasts for a location. Not for historical weather, severe alerts, aviation, marine, or climate analysis.
homepage: https://wttr.in/:help
metadata:
  {
    "crawclaw":
      {
        "emoji": "☔",
        "requires": { "bins": ["curl"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "curl",
              "bins": ["curl"],
              "label": "Install curl (brew)",
            },
          ],
      },
  }
---

# Weather Skill

Use this skill for current conditions and short forecasts.

## Use this skill when

- the user asks for weather, temperature, or rain outlook
- the request is about today, tomorrow, or a short trip-planning forecast

Do not use this skill for historical datasets, severe weather alerts, aviation or marine weather, or climate analysis.

## Working rules

- Always include a city, region, or airport code in the query.
- Prefer concise one-line summaries unless the user asks for more detail.
- Do not spam repeated requests; `wttr.in` is rate-limited.

## Reference routing

- Read `references/usage.md` for concrete `curl` formats and examples.

## Handoff

Return the weather answer directly in user-facing language, not raw command output.
