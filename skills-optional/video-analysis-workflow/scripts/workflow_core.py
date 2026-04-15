#!/usr/bin/env python3
"""Workflow core helpers for job-based video analysis."""

from __future__ import annotations

from pathlib import Path
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import analyze_video as legacy

SUCCESS_RATE_THRESHOLD = legacy.SUCCESS_RATE_THRESHOLD

get_workflow_missing_dependencies = legacy.get_workflow_missing_dependencies
ensure_workflow_dependencies = legacy.ensure_workflow_dependencies
get_video_understand_missing_envs = legacy.get_video_understand_missing_envs
get_video_id = legacy.get_video_id
resolve_input_video = legacy.resolve_input_video
preprocess_video = legacy.preprocess_video
detect_scenes = legacy.detect_scenes
cut_scenes = legacy.cut_scenes
check_analysis_completeness = legacy.check_analysis_completeness
create_report = legacy.create_report


def setup_logging(output_dir: Path, video_id: str):
    return legacy.setup_logging(output_dir, video_id)


def set_logger(logger) -> None:
    legacy.logger = logger


def analyze_scene(scene_path: str, idx: int, total: int, scene: dict, question: str | None = None) -> dict:
    return legacy.analyze_scene(scene_path, idx, total, scene, question)
