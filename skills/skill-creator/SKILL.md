---
name: skill-creator
description: Use when adding, refactoring, tightening, evaluating, packaging, or comparing skills, especially when improving SKILL.md trigger descriptions, pruning stale wording, or deciding when a skill should fire.
---

# Skill Creator

Use this skill as the owner for skill design, cleanup, and evaluation.

## Core workflow

1. Classify the request:
   - new skill
   - existing skill cleanup
   - trigger-description optimization
   - eval / benchmark request
2. Keep the scope concrete:
   - what the skill should do
   - when it should trigger
   - which files are canonical
   - whether scripts / references / assets are actually needed
3. Prefer lean `SKILL.md` files:
   - keep only non-obvious workflow rules
   - move detailed procedures into `references/`
   - keep `name` and `description` as the trigger-defining layer
4. Validate before claiming completion:
   - run `scripts/quick_validate.py` with the install-time `core-skills` Python runtime available
   - use representative prompts or comparisons when the change is meaningful
5. Optimize trigger wording last:
   - first make the workflow correct
   - then tighten the description so the skill fires reliably

## Reference routing

### Skill schema and benchmark data

Read `references/schemas.md` when you need:

- eval input schema
- benchmark output shape
- grading data structure

### Evaluation helpers

Read these only when the task includes measurement:

- `agents/grader.md`
- `agents/analyzer.md`

### Execution helpers

Use these when the task reaches validation or packaging:

- `scripts/quick_validate.py`
- `scripts/aggregate_benchmark.py`
- `scripts/improve_description.py`
- `eval-viewer/generate_review.py`

## Working rules

- Keep one canonical skill file per real capability.
- Remove stale aliases, duplicated wording, and dead examples when they no longer help triggering.
- Do not leave detailed operational docs inside `SKILL.md` if a reference file can carry them.
- Prefer realistic eval prompts over toy examples.
- Explain results in plain language, not benchmark jargon alone.
