#!/usr/bin/env python3
"""
Quick validation script for skills - minimal version
"""

import os
import re
import sys
from pathlib import Path

ALLOWED_PROPERTIES = {
    'allowed-tools',
    'compatibility',
    'description',
    'disable-model-invocation',
    'homepage',
    'license',
    'metadata',
    'name',
    'user-invocable',
}

CORE_SKILLS_REEXEC_ENV = "CRAWCLAW_CORE_SKILLS_REEXECED"


def _resolve_core_skills_python():
    override = os.environ.get("CRAWCLAW_CORE_SKILLS_PYTHON")
    if override:
        return Path(override).expanduser()

    state_dir = Path(os.environ.get("CRAWCLAW_STATE_DIR", Path.home() / ".crawclaw")).expanduser()
    venv_dir = state_dir / "runtimes" / "core-skills" / "venv"
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def _maybe_reexec_with_core_skills_python():
    if os.environ.get(CORE_SKILLS_REEXEC_ENV) == "1":
        return
    python_path = _resolve_core_skills_python()
    if not python_path.exists():
        return
    try:
        if Path(sys.executable).resolve() == python_path.resolve():
            return
    except OSError:
        pass
    env = os.environ.copy()
    env[CORE_SKILLS_REEXEC_ENV] = "1"
    os.execve(str(python_path), [str(python_path), *sys.argv], env)


def _load_yaml_module():
    try:
        import yaml
    except ImportError:
        _maybe_reexec_with_core_skills_python()
        return None
    return yaml


def _parse_frontmatter(frontmatter_text):
    yaml_module = _load_yaml_module()
    if yaml_module is None:
        return None, (
            "PyYAML is required for skill validation. CrawClaw installs it in the "
            "core-skills runtime during project install/postinstall; run "
            "`crawclaw runtimes install` or use "
            "`~/.crawclaw/runtimes/core-skills/venv/bin/python`."
        )

    try:
        frontmatter = yaml_module.safe_load(frontmatter_text)
        if not isinstance(frontmatter, dict):
            return None, "Frontmatter must be a YAML dictionary"
        return frontmatter, None
    except yaml_module.YAMLError as e:
        return None, f"Invalid YAML in frontmatter: {e}"


def validate_skill(skill_path):
    """Basic validation of a skill"""
    skill_path = Path(skill_path)

    # Check SKILL.md exists
    skill_md = skill_path / 'SKILL.md'
    if not skill_md.exists():
        return False, "SKILL.md not found"

    # Read and validate frontmatter
    content = skill_md.read_text(encoding='utf-8')
    if not content.startswith('---'):
        return False, "No YAML frontmatter found"

    # Extract frontmatter
    match = re.match(r'^---\n(.*?)\n---', content, re.DOTALL)
    if not match:
        return False, "Invalid frontmatter format"

    frontmatter_text = match.group(1)

    # Parse YAML frontmatter through the managed core-skills Python runtime.
    frontmatter, parse_error = _parse_frontmatter(frontmatter_text)
    if parse_error:
        return False, parse_error

    # Check for unexpected properties (excluding nested keys under metadata)
    unexpected_keys = set(frontmatter.keys()) - ALLOWED_PROPERTIES
    if unexpected_keys:
        return False, (
            f"Unexpected key(s) in SKILL.md frontmatter: {', '.join(sorted(unexpected_keys))}. "
            f"Allowed properties are: {', '.join(sorted(ALLOWED_PROPERTIES))}"
        )

    # Check required fields
    if 'name' not in frontmatter:
        return False, "Missing 'name' in frontmatter"
    if 'description' not in frontmatter:
        return False, "Missing 'description' in frontmatter"

    # Extract name for validation
    name = frontmatter.get('name', '')
    if not isinstance(name, str):
        return False, f"Name must be a string, got {type(name).__name__}"
    name = name.strip()
    if name:
        # Check naming convention (kebab-case: lowercase with hyphens)
        if not re.match(r'^[a-z0-9-]+$', name):
            return False, f"Name '{name}' should be kebab-case (lowercase letters, digits, and hyphens only)"
        if name.startswith('-') or name.endswith('-') or '--' in name:
            return False, f"Name '{name}' cannot start/end with hyphen or contain consecutive hyphens"
        # Check name length (max 64 characters per spec)
        if len(name) > 64:
            return False, f"Name is too long ({len(name)} characters). Maximum is 64 characters."

    # Extract and validate description
    description = frontmatter.get('description', '')
    if not isinstance(description, str):
        return False, f"Description must be a string, got {type(description).__name__}"
    description = description.strip()
    if description:
        # Check for angle brackets
        if '<' in description or '>' in description:
            return False, "Description cannot contain angle brackets (< or >)"
        # Check description length (max 1024 characters per spec)
        if len(description) > 1024:
            return False, f"Description is too long ({len(description)} characters). Maximum is 1024 characters."

    # Validate compatibility field if present (optional)
    compatibility = frontmatter.get('compatibility', '')
    if compatibility:
        if not isinstance(compatibility, str):
            return False, f"Compatibility must be a string, got {type(compatibility).__name__}"
        if len(compatibility) > 500:
            return False, f"Compatibility is too long ({len(compatibility)} characters). Maximum is 500 characters."

    return True, "Skill is valid!"

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python quick_validate.py <skill_directory>")
        sys.exit(1)

    valid, message = validate_skill(sys.argv[1])
    print(message)
    sys.exit(0 if valid else 1)
