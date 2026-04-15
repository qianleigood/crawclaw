---
name: transnetv2-scene-detect
description: TransNetV2-based video scene detection skill. Use when a task needs high-accuracy shot boundary detection, local scene splitting, or downstream video-analysis workflows that depend on the TransNetV2 pipeline.
---

# TransNetV2 Scene Detect

Use this as the default high-accuracy scene detection path.

## Use this skill for

- scene boundary detection
- local video preprocessing and cutting
- generating shot JSON outputs
- supporting `video-analysis-workflow`

## Default workflow

1. Use `run.sh` for the main entry path.
2. Ensure weights exist at the expected asset path.
3. Write outputs into `output/`, not the skill root.
4. Keep script names and asset paths stable unless downstream references are updated too.

## Read references as needed

- `references/README.md`
  For historical notes, structure background, and migration details.

## Working rules

- Treat `output/` as runtime artifacts, not source.
- Treat `archive/` as history, not active guidance.
- Do not casually move scripts, weights, or directory layout while `video-analysis-workflow` depends on them.
