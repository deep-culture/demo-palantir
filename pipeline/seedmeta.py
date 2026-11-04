"""
pipeline/seedmeta.py — seed contract versioning (REDESIGN_SPEC.md §6.2).

Both seed builders stamp every dataset with::

    "metadata": {
        "schemaVersion": 3,
        "buildId": "sha256:<hex>",
        "sources": {"watchlist.csv": "sha256:<hex>", ...},
        "builder": "build_ontology_seed.py@<git short sha or 'dirty'>",
        ...
    }

``buildId`` is deterministic: a SHA-256 over the dataset's raw source files
(sorted by name), the builder script's source and every ``pipeline/*.py``
file (sorted by path).  No timestamps go in.  Text is hashed with line
endings normalised to LF, so a checkout with CRLF files (e.g. a Windows or
Mac copy) produces the same ``buildId`` as git's LF copy.

The browser apps compare the stored ``schemaVersion``/``buildId`` with the
seed's to decide whether saved edits are stale.
"""

from __future__ import annotations

import hashlib
import subprocess
from pathlib import Path
from typing import Dict, List

SCHEMA_VERSION = 3
SOURCE_SUFFIXES = (".csv", ".jsonl", ".json")
REPO_ROOT = Path(__file__).resolve().parent.parent


def _normalised_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    return data.replace(b"\r\n", b"\n").replace(b"\r", b"\n")


def _sha256(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def source_files(dataset_dir: Path) -> List[Path]:
    return sorted(
        (p for p in Path(dataset_dir).iterdir()
         if p.is_file() and not p.name.startswith(".") and p.suffix in SOURCE_SUFFIXES),
        key=lambda p: p.name,
    )


def code_files(builder_script: Path) -> List[Path]:
    pipeline = sorted((REPO_ROOT / "pipeline").glob("*.py"), key=lambda p: p.name)
    return [Path(builder_script).resolve()] + [p.resolve() for p in pipeline]


def _rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.name


def compute_build_id(dataset_dir: Path, builder_script: Path) -> Dict[str, object]:
    """Return ``{"buildId": ..., "sources": {...}}`` for one dataset."""
    digest = hashlib.sha256()
    sources: Dict[str, str] = {}
    for path in source_files(dataset_dir):
        data = _normalised_bytes(path)
        sources[path.name] = _sha256(data)
        digest.update(b"source\0" + path.name.encode("utf-8") + b"\0" + data + b"\0")
    for path in code_files(builder_script):
        data = _normalised_bytes(path)
        digest.update(b"code\0" + _rel(path).encode("utf-8") + b"\0" + data + b"\0")
    return {"buildId": "sha256:" + digest.hexdigest(), "sources": sources}


def builder_label(builder_script: Path, dataset_dir: Path) -> str:
    """``<script>@<git short sha>``, or ``@dirty`` if an input differs from HEAD."""
    name = Path(builder_script).name
    inputs = [_rel(Path(builder_script)), "pipeline", _rel(Path(dataset_dir))]
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT,
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        status = subprocess.run(
            ["git", "status", "--porcelain", "--", *inputs], cwd=REPO_ROOT,
            capture_output=True, text=True, check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return f"{name}@unknown"
    return f"{name}@{'dirty' if status else sha}"


def build_metadata(dataset_dir: Path, builder_script: Path) -> Dict[str, object]:
    meta: Dict[str, object] = {"schemaVersion": SCHEMA_VERSION}
    meta.update(compute_build_id(dataset_dir, builder_script))
    meta["builder"] = builder_label(builder_script, dataset_dir)
    return meta
