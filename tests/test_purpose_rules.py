"""PHASE2_CONTRACT.md §4: purpose rules ("Karlsruhe mode") and the legal-basis note."""

from __future__ import annotations

import json

import pytest

from conftest import DATASETS, REPO_ROOT

RULE_SHAPES = [
    {"id": "R1", "text": "Automated cross-dataset analysis needs a stated purpose on the session.",
     "operations": ["expand", "rule", "action"], "requires": "sessionPurpose", "effect": "block"},
    {"id": "R2", "text": "Data collected for healthcare may not be combined with law-enforcement purposes.",
     "operations": ["expand", "rule", "action", "view"],
     "incompatible": {"data": ["healthcare"], "session": ["public-order", "financial-crime"]}, "effect": "block"},
    {"id": "R3", "text": "Expansion beyond the first hop requires a concrete, logged danger statement.",
     "operations": ["expand"], "depthOver": 1, "effect": "checkpoint", "checkpointId": "cp-danger-statement"},
]
# What each rule's note must say (FIXROUND_CONTRACT.md §1, Karlsruhe notes).
NOTE_MUST_SAY = {
    "R1": ["thinnest form", "purpose limitation"],
    "R2": ["GDPR Art. 9", "LED Art. 10", "stricter than EU law", "strictly necessary"],
    "R3": ["Our device", "sufficiently identifiable danger", "length"],
}


def blocks(gotham, foundry):
    for seed in (gotham, foundry):
        for dataset in DATASETS:
            yield seed[dataset]["governance"]


def test_rules_exact(gotham, foundry):
    ref = None
    for block in blocks(gotham, foundry):
        rules = block["purposeRules"]
        assert [{k: v for k, v in r.items() if k != "note"} for r in rules] == RULE_SHAPES
        ref = ref or (rules, block["legalBasisNote"])
        assert (rules, block["legalBasisNote"]) == ref


def test_rule_notes_say_what_each_rule_abstracts(gotham):
    block = gotham["starter"]["governance"]
    for rule in block["purposeRules"]:
        note = rule["note"]
        for phrase in NOTE_MUST_SAY[rule["id"]]:
            assert phrase.lower() in note.lower(), (rule["id"], phrase)


def test_legal_basis_note(gotham):
    note = gotham["starter"]["governance"]["legalBasisNote"]
    assert "[" not in note and "to verify" not in note
    assert "press release 18/2023" in note
    assert "addressed the legislature" in note
    assert "written reason for each use" in note
    assert "not its text" in note


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
    # The DPO (the only role that sees HEALTH) can test R2 under public order.
    assert role_purposes["dpo"] == ["oversight", "public-order"]
    r2 = next(r for r in block["purposeRules"] if r["id"] == "R2")
    assert set(role_purposes["dpo"]) & set(r2["incompatible"]["session"])


@pytest.mark.parametrize("dataset", DATASETS)
def test_health_data_carries_the_healthcare_purpose(gotham, foundry, dataset):
    """R2 needs to know which data is healthcare data: the manifest says so, and HEALTH marks it."""
    manifest = json.loads((REPO_ROOT / "synthetic_data" / dataset / "manifest.json").read_text())
    assert manifest["clinic_registrations"]["purpose"] == "healthcare"
    assert manifest["clinic_registrations"]["markings"] == ["PII", "HEALTH"]
    healthcare = [k for k, v in manifest.items() if v["purpose"] == "healthcare"]
    assert healthcare == ["clinic_registrations"]
    sources = {s["id"]: s for s in gotham[dataset]["sources"]}
    assert sources["clinic_registrations.csv"]["purpose"] == "healthcare"
    persons_ds = next(d for d in foundry[dataset]["datasets"] if d["id"] == "resolved_persons")
    assert "healthcare" in persons_ds["inputPurposes"]
