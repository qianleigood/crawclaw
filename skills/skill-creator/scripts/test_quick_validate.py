#!/usr/bin/env python3
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from quick_validate import validate_skill


class QuickValidateTest(unittest.TestCase):
    def test_reports_missing_pyyaml_without_ad_hoc_parser(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            skill_dir = Path(tmp_dir) / "sample-skill"
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(
                """---
name: sample-skill
description: Use when validating a skill on a Python without PyYAML installed.
homepage: https://example.com/skills/sample
user-invocable: true
disable-model-invocation: false
metadata:
  {
    "crawclaw": { "emoji": "check" },
  }
---

# Sample Skill
""",
                encoding="utf-8",
            )

            with (
                mock.patch.dict(sys.modules, {"yaml": None}),
                mock.patch.dict("os.environ", {"CRAWCLAW_STATE_DIR": tmp_dir}, clear=False),
            ):
                valid, message = validate_skill(skill_dir)

        self.assertFalse(valid)
        self.assertIn("PyYAML is required", message)

    def test_validates_basic_skill_with_yaml_module(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            skill_dir = Path(tmp_dir) / "sample-skill"
            skill_dir.mkdir()
            (skill_dir / "SKILL.md").write_text(
                """---
name: sample-skill
description: Use when validating a skill with PyYAML installed.
homepage: https://example.com/skills/sample
user-invocable: true
disable-model-invocation: false
metadata:
  {
    "crawclaw": { "emoji": "check" },
  }
---

# Sample Skill
""",
                encoding="utf-8",
            )

            fake_yaml = types.SimpleNamespace(
                YAMLError=Exception,
                safe_load=lambda _text: {
                    "name": "sample-skill",
                    "description": "Use when validating a skill with PyYAML installed.",
                    "homepage": "https://example.com/skills/sample",
                    "user-invocable": True,
                    "disable-model-invocation": False,
                    "metadata": '{ "crawclaw": { "emoji": "check" } }',
                },
            )
            with mock.patch.dict(sys.modules, {"yaml": fake_yaml}):
                valid, message = validate_skill(skill_dir)

        self.assertTrue(valid, message)


if __name__ == "__main__":
    unittest.main()
