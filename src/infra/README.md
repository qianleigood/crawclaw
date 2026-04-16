# Infra

`src/infra/**` is for shared infrastructure primitives.

Allowed responsibilities:

- low-level filesystem, path, and JSON helpers
- process, network, retry, and OS primitives
- installation and update mechanics
- runtime guards, safety checks, and generic transport helpers
- genuinely cross-domain utility code with no strong product ownership

## White-list Principle

New code belongs in `src/infra/**` only if it is still sensible after removing
agent, channel, workflow, memory, and gateway product nouns from the design.

If a helper is really about:

- agent policy
- session orchestration
- channel behavior
- workflow state
- memory policy
- plugin ownership

then it should live in that domain instead.

## Boundary Rules

- Do not use `src/infra/**` as the default landing zone for new cross-file glue.
- Avoid adding new product policy branches here just because multiple callers need them.
- Prefer moving domain-owned helpers back into the owning tree when a function stops being generic.

## Review Notes

- This directory still contains historical mixed ownership. Treat that as cleanup debt, not precedent.
- When in doubt, ask whether the code would make sense as a small internal package with no product-specific language. If not, it probably does not belong here.
