# Memory vs Skill

This document defines the boundary between memory and skills in CrawClaw.

## Short Version

- `memory` stores what the system should remember
- a `skill` stores how the system should do something

Memory is retained knowledge. A skill is reusable method.

## Memory

Memory is for retained information.

It captures:

- facts
- preferences
- context
- summaries
- durable knowledge

Memory is primarily descriptive.

It helps the agent answer:

- What do I know?
- What should I remember?
- What matters for this user, project, or environment?

## Skill

A skill is for reusable execution method.

It captures:

- a structured way to solve a class of problems
- instructions that should be reused
- stable problem-solving patterns
- domain-specific methods

A skill is primarily procedural.

It helps the agent answer:

- How should I do this?
- Which method should I reuse here?

## Boundary Rule

If something is knowledge about the world, keep it in memory.

If something is a reusable way of working, make it a skill.

Examples:

- "The user prefers concise answers" -> memory
- "When reviewing migration diffs, check generated imports first" -> skill
- "Project X uses provider Y by default" -> memory
- "For provider Y onboarding, validate env, aliases, and subpath exports in this order" -> skill

## What Belongs In Memory

Use memory for:

- user preferences
- project facts
- retained decisions
- constraints
- historical conclusions
- durable context summaries

Memory should tell the system what is true or important.

## What Belongs In A Skill

Use a skill for:

- repeatable procedures
- domain methods
- specialized workflows at the instruction level
- reusable problem-solving sequences
- task-specific heuristics

A skill should tell the system how to proceed.

## Anti-Patterns

### Putting execution instructions in memory

This makes recall noisy and weakens reuse.

Symptoms:

- prompt assembly includes scattered procedural notes
- the same technique gets rediscovered repeatedly
- behavior is inconsistent across sessions

### Putting factual state into skills

This makes skills stale and overly contextual.

Symptoms:

- skills become full of project-specific facts
- skill reuse drops
- updates require changing many skills instead of updating memory

## Promotion Rule

The intended flow is:

1. Repeated successful work happens.
2. The system retains durable facts in memory.
3. When the method itself becomes stable and reusable, it is promoted to a skill.

That means:

- memory can inform skills
- memory should not replace skills
- skills should not be used as fact storage

## Product Framing

Use this wording consistently:

- Memory answers: "What should be remembered?"
- Skill answers: "What reusable method should be applied?"

## Architectural Mapping

Memory-heavy areas today include:

- `src/memory`
- `src/memory/engine`
- `src/memory/durable`
- `src/memory/knowledge`

Skill-heavy areas today include:

- `src/agents/skills`
- `skills/`

## Decision Test

Ask two questions:

1. Is this mainly a fact, preference, or retained context?
2. Or is this mainly a reusable way of solving a problem?

If the first is true, it belongs in memory.

If the second is true, it belongs in a skill.
