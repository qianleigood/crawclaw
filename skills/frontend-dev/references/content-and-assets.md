# Content and Asset Workflow

Use this reference when the frontend requires real copy and generated media assets.

## Asset workflow

1. Parse all asset requirements before coding final sections.
2. Decide which assets are images, video, audio, or music.
3. Write prompts that match the page strategy.
4. Confirm prompts with the user when the media direction meaningfully affects output.
5. Generate assets with local scripts.
6. Save assets locally and reference only local paths in the built project.

## Hard rule

Do not use placeholder services (`unsplash`, `picsum`, `placeholder.com`, `placehold.co`, etc.) in final output unless the user explicitly asks for placeholder-only scaffolding.

## Copywriting workflow

Use real copy, not lorem ipsum.

Prefer lightweight persuasive frameworks:

- AIDA
- PAS
- FAB

Match the product stage and audience:

- landing pages → hook + differentiation + CTA
- product pages → feature clarity + proof + objections
- dashboards → low-drama, high-clarity microcopy

## Visual art / generative media

Use visual art layers only when they materially improve the experience.

Good use cases:

- campaign pages
- hero backgrounds
- launch microsites
- immersive showcases

Bad default use cases:

- admin dashboards
- dense enterprise CRUD screens
- any place where readability drops significantly

## Read next

- model-specific generation guides under `references/`
- `references/asset-prompt-guide.md`
- `references/troubleshooting.md`
