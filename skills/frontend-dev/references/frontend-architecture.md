# Frontend Architecture Guide

Use this reference when you need concrete layout, framework, and component structure decisions.

## Recommended structure

### Universal asset layout

```text
assets/
├── images/
├── videos/
└── audio/
```

Asset naming:

```text
{type}-{descriptor}-{timestamp}.{ext}
```

### Framework mapping

| Framework | Asset location | Component location |
|---|---|---|
| Pure HTML | `./assets/` | inline or `./js/` |
| React / Next.js | `public/assets/` | `src/components/` |
| Vue / Nuxt | `public/assets/` | `src/components/` |
| Svelte / SvelteKit | `static/assets/` | `src/lib/components/` |
| Astro | `public/assets/` | `src/components/` |

## Baseline conventions

- Verify dependencies before importing any library.
- Prefer React / Next.js unless the user or repo already dictates another stack.
- For Next.js, default to Server Components and isolate interactivity into client leaf components.
- Use Tailwind only in a version-consistent way; do not mix v3/v4 syntax.
- Prefer CSS Grid over fragile flex percentage math.
- Use `min-h-[100dvh]` instead of `h-screen`.
- Use a bounded layout like `max-w-[1400px] mx-auto` or `max-w-7xl`.

## Design dials

| Dial | Default | Meaning |
|---|---:|---|
| `DESIGN_VARIANCE` | 8 | 1 = symmetric / 10 = asymmetric |
| `MOTION_INTENSITY` | 6 | 1 = static / 10 = cinematic |
| `VISUAL_DENSITY` | 4 | 1 = airy / 10 = packed |

Adapt them from the user request rather than treating them as fixed.

## High-value design rules

- Typography: strong hierarchy, tight tracking, readable body width.
- Color: one accent palette is usually enough.
- Layout: when variance is high, avoid generic centered-hero defaults.
- States: always include loading, empty, error, and tactile interaction states.
- Components: do not ship default library styles untouched.

## Forbidden patterns

Avoid:

- placeholder image services in final output
- emoji-based UI styling
- neon glow / oversaturated AI-looking palettes by default
- generic equal-width 3-column card grids when the page needs hierarchy
- custom cursors unless explicitly requested and justified

## Bento / premium UI guidance

Use premium surface patterns when appropriate:

- softened cards
- strong spacing hierarchy
- restrained glass / blur treatment
- motion that supports information hierarchy rather than distracts from it

## Read next

- `references/motion-system.md` for animation and performance rules
- `references/content-and-assets.md` for media generation and copy workflow
- `references/motion-recipes.md` for implementation snippets
- existing MiniMax references for model-specific usage
