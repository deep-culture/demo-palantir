"""Both apps show the same objects: the two seed builders must agree on properties, not just ids (review F-08).

demo/seed.js (Investigate) is built by scripts/build_ontology_seed.py; foundry-demo/seed.js (Build) by
scripts/build_foundry_seed.py through pipeline/. The resolution parity test compares ids and link triples;
this one compares every entity property and every link property for the ids both seeds hold.
"""
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _load(rel):
    text = (ROOT / rel).read_text(encoding="utf-8")
    return json.loads(text[text.index("{"): text.rindex("}") + 1])


GOTHAM = _load("demo/seed.js")
FOUNDRY = _load("foundry-demo/seed.js")
DATASETS = sorted(set(GOTHAM) & set(FOUNDRY))


def _entity_diffs(ds):
    a = {e["id"]: e for e in GOTHAM[ds]["entities"]}
    b = {e["id"]: e for e in FOUNDRY[ds]["entities"]}
    out = []
    for eid in sorted(a.keys() & b.keys()):
        pa, pb = a[eid].get("properties") or {}, b[eid].get("properties") or {}
        for key in sorted(set(pa) | set(pb)):
            va, vb = pa.get(key), pb.get(key)
            if va in ("", None) and vb in ("", None):
                continue
            if va != vb:
                out.append((eid, key, va, vb))
    return out


def _edge_diffs(ds):
    def index(seed):
        return {(e["type"], e["source"], e["target"]): e for e in seed[ds]["edges"]}

    a, b = index(GOTHAM), index(FOUNDRY)
    out = []
    for key in sorted(a.keys() & b.keys()):
        pa, pb = a[key].get("properties") or {}, b[key].get("properties") or {}
        for prop in sorted(set(pa) | set(pb)):
            va, vb = pa.get(prop), pb.get(prop)
            if va in ("", None) and vb in ("", None):
                continue
            if va != vb:
                out.append((key, prop, va, vb))
    return out


@pytest.mark.parametrize("ds", DATASETS)
def test_entity_properties_agree(ds):
    diffs = _entity_diffs(ds)
    assert not diffs, f"{len(diffs)} entity property differences in {ds}, e.g. {diffs[:5]}"


@pytest.mark.parametrize("ds", DATASETS)
def test_link_properties_agree(ds):
    diffs = _edge_diffs(ds)
    assert not diffs, f"{len(diffs)} link property differences in {ds}, e.g. {diffs[:5]}"
