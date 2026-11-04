"""Shared fixtures: build both seeds once per test session and parse them.

Seeds are built with the real CLIs into a temporary directory (set
``DC_SEED_DIR`` to reuse seeds that ``scripts/check.sh`` already built).
"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

DATASETS = ("starter", "simulator")
GOTHAM_VAR = "window.ontologySeedCatalog"
FOUNDRY_VAR = "window.foundrySeedCatalog"


def parse_seed_js(path: Path, var: str) -> Dict[str, Any]:
    """Parse ``<var> = {...};\\nwindow.x = ...;`` written by the builders."""
    text = path.read_text(encoding="utf-8")
    prefix = f"{var} = "
    assert text.startswith(prefix), f"{path} does not start with {prefix!r}"
    body = text[len(prefix):]
    end = body.index(";\nwindow.")
    return json.loads(body[:end])


def load_script(name: str):
    path = REPO_ROOT / "scripts" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"_test_{name}", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def seed_dir(tmp_path_factory) -> Path:
    preset = os.environ.get("DC_SEED_DIR")
    if preset:
        return Path(preset)
    out = tmp_path_factory.mktemp("seeds")
    for script, name in (("build_ontology_seed.py", "gotham-seed.js"), ("build_foundry_seed.py", "foundry-seed.js")):
        subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / script), "--output", str(out / name)],
            cwd=REPO_ROOT, check=True, capture_output=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )
    return out


@pytest.fixture(scope="session")
def gotham_path(seed_dir) -> Path:
    return seed_dir / "gotham-seed.js"


@pytest.fixture(scope="session")
def foundry_path(seed_dir) -> Path:
    return seed_dir / "foundry-seed.js"


@pytest.fixture(scope="session")
def gotham(gotham_path) -> Dict[str, Any]:
    return parse_seed_js(gotham_path, GOTHAM_VAR)


@pytest.fixture(scope="session")
def foundry(foundry_path) -> Dict[str, Any]:
    return parse_seed_js(foundry_path, FOUNDRY_VAR)


def persons(seed_entry: Dict[str, Any]):
    return [e for e in seed_entry["entities"] if e["type"] == "Person"]
