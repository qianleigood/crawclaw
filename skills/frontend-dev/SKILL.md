---
name: frontend-dev
description: Use when building or improving browser-facing UI where visual hierarchy, responsive layout, interaction design, motion, media, copy, or product polish is the main challenge.
license: MIT
metadata:
  version: "1.0.0"
  category: frontend
---

# Frontend Studio

Use this as the default workflow for premium frontend work.

## Use this skill when

- the job is mainly about what users see and interact with in the browser
- visual design, motion, copy, and media matter as much as code
- React or Next.js is only the implementation substrate
- backend or data work is secondary, absent, or already decided

Do not use this skill for backend-only work, database/service design, or React-internal debugging where hooks, render behavior, or state architecture are the real problem.

## Default workflow

1. Define the page type, audience, conversion goal, and target stack.
2. Set design dials explicitly:
   - `DESIGN_VARIANCE`
   - `MOTION_INTENSITY`
   - `VISUAL_DENSITY`
3. Plan the section structure and required media.
4. Choose motion deliberately and keep reduced-motion support in scope.
5. Generate or gather real local assets before final build.
6. Build the UI and verify responsive, empty, error, and reduced-motion states.

## Working rules

- Verify dependencies before importing libraries.
- Do not ship placeholder media in final output unless the user explicitly wants scaffolding.
- Prefer CSS Grid over brittle percentage math.
- Avoid generic AI-looking UI defaults.
- Use icons instead of emojis in product UI unless the user explicitly wants emojis.

## Read references as needed

- `references/frontend-architecture.md`
  For project structure, layout rules, asset paths, and visual direction.
- `references/motion-system.md` and `references/motion-recipes.md`
  For animation tool choice, performance, and reduced-motion handling.
- `references/content-and-assets.md`
  For media planning, copywriting, and asset workflow sequencing.
- `references/minimax-*.md`, `references/env-setup.md`, `references/troubleshooting.md`
  For model-specific generation and environment details.

## Handoff

Always report:

- what was built
- how to run it
- which design dials were chosen
- where the local assets live
- any reduced-motion handling
- notable tradeoffs or deferred improvements
