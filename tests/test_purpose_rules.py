"""PHASE2_CONTRACT.md §4: purpose rules ("Karlsruhe mode") and the legal-basis note."""

from __future__ import annotations

import json

import pytest

from conftest import DATASETS, REPO_ROOT

RULES = [
    {"id": "R1", "text": "Automated cross-dataset analysis needs a stated purpose on the session.",
     "operations": ["expand", "rule", "action"], "requires": "sessionPurpose", "effect": "block"},
    {"id": "R2", "text": "Data collected for healthcare may not be combined with law-enforcement purposes.",
     "operations": ["expand", "rule", "action", "view"],
     "incompatible": {"data": ["healthcare"], "session": ["public-order", "financial-crime"]}, "effect": "block"},
    {"id": "R3", "text": "Expansion beyond the first hop requires a concrete, logged danger statement.",
     "operations": ["expand"], "depthOver": 1, "effect": "checkpoint", "checkpointId": "cp-danger-statement"},
]
NOTE = ("Our abstraction of the BVerfG 2023 ruling's logic, not its text "
        "[to verify against the press release before teaching as the court's criteria].")


def blocks(gotham, foundry):
    for seed in (gotham, foundry):
        for dataset in DATASETS:
            yield seed[dataset]["governance"]


def test_rules_exact(gotham, foundry):
    for block in blocks(gotham, foundry):
        assert block["purposeRules"] == RULES
        assert block["legalBasisNote"] == NOTE


def test_rules_reference_known_purposes_and_checkpoints(gotham):
    block = gotham["starter"]["governance"]
    purposes = {p["id"] for p in block["purposes"]}
    checkpoints = {c["id"] for c in block["checkpoints"]}
    for rule in block["purposeRules"]:
        assert rule["effect"] in ("block", "checkpoint")
        if rule["effect"] == "checkpoint":
            assert rule["checkpointId"] in checkpoints
        for side in rule.get("incompatible", {}).values():
            assert set(side) <= purposes
    # The session purposes R2 blocks are the investigating roles' purposes.
    role_purposes = {r["id"]: r["purposes"] for r in block["roles"]}
    assert set(role_purposes["patrol"] + role_purposes["fin-analyst"]) == {"public-order", "financial-crime"}


@pytest.mark.parametrize("dataset", DATASETS)
def test_health_data_carries_the_healthcare_purpose(gotham, foundry, dataset):
    """R2 needs to know which data is healthcare data: the manifest says so, and HEALTH marks it."""
    manifest = json.loads((REPO_ROOT / "synthetic_data" / dataset / "manifest.json").read_text())
    assert manifest["clinic_registrations"]["purpose"] == "healthcare"
    assert manifest["clinic_registrations"]["markings"] == ["HEALTH"]
    healthcare = [k for k, v in manifest.items() if v["purpose"] == "healthcare"]
    assert healthcare == ["clinic_registrations"]
    sources = {s["id"]: s for s in gotham[dataset]["sources"]}
    assert sources["clinic_registrations.csv"]["purpose"] == "healthcare"
    persons_ds = next(d for d in foundry[dataset]["datasets"] if d["id"] == "resolved_persons")
    assert "healthcare" in persons_ds["inputPurposes"]
