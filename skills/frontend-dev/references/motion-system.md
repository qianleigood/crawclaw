# Motion System Guide

Use this reference when the request needs animation, scroll choreography, cinematic transitions, or premium interaction polish.

## Tool selection

- **Framer Motion**: component-level transitions, layout animation, springs, shared element transitions.
- **GSAP**: timeline-heavy sequences, complex scroll choreography, hero scenes, precision control.
- **CSS / Tailwind**: subtle hover/focus/entrance states.
- **Three.js / WebGL**: only when the visual payoff justifies the complexity.

## Intensity scale

| Intensity | Behavior |
|---|---|
| 1-3 | restrained, subtle, mostly static |
| 4-6 | polished UI motion, premium but practical |
| 7-10 | cinematic sequences, storytelling motion, stronger choreography |

## Performance rules

- Prefer transform / opacity over layout-thrashing properties.
- Keep heavy motion isolated.
- Treat infinite animation as a deliberate design choice, not a default.
- Add reduced-motion fallbacks.
- Verify mobile performance before shipping large motion systems.

## Accessibility

- Respect `prefers-reduced-motion`.
- Do not hide essential meaning behind animation only.
- Ensure keyboard focus states remain clear even when motion is added.

## Practical recipes

For concrete code snippets, read `references/motion-recipes.md`.
