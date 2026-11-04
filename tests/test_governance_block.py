"""PHASE1_CONTRACT.md §1–§2: the seeded governance block matches the contract tables.

The expected values below are copied from the contract by hand (not imported
from pipeline/governance.py), so a change to either side fails here.
"""

from __future__ import annotations

from urllib.parse import urlparse

import pytest

from conftest import DATASETS, REPO_ROOT

ALL = ["OPEN", "PII", "FIN", "TELECOM", "HEALTH", "LE-SENSITIVE"]

MARKINGS = {
    "OPEN": ("Open", "No restriction."),
    "PII": ("Personal data", "Identifies a living person."),
    "FIN": ("Financial", "Bank and payment data."),
    "TELECOM": ("Telecom", "Phone numbers, handsets and location pings."),
    "HEALTH": ("Health", "Collected for care; purpose-limited."),
    "LE-SENSITIVE": ("Law-enforcement sensitive", "Watchlist and intelligence."),
}

# id: (label, markingsVisible, purposes, canApprove, canRemoveMarkings, canOpenOversight)
ROLES = {
    "patrol": ("Patrol officer", ["OPEN", "PII", "TELECOM", "LE-SENSITIVE"], ["public-order"], False, False, False),
    "fin-analyst": ("Financial-crime analyst", ["OPEN", "PII", "FIN", "LE-SENSITIVE"], ["financial-crime"], True, False, False),
    "dpo": ("Data protection officer", ALL, ["oversight"], False, True, True),
    "auditor": ("Auditor", ["OPEN"], ["oversight"], False, False, True),
    "contractor": ("Platform contractor", ["OPEN"], ["maintenance"], False, False, False),
}

PURPOSES = ["public-order", "financial-crime", "oversight", "maintenance", "healthcare",
            "sanctions-screening", "border-security", "telecom-billing", "public-record"]

# id: (trigger, allowedRoles, prompt)
CHECKPOINTS = {
    "cp-expand-telecom": ("graph.expand.telecom", ["patrol", "fin-analyst", "dpo"],
                          "You are about to expand from a person to their devices and every place those devices were observed. State the investigative purpose."),
    "cp-search-phone": ("search.byPhone", ["patrol", "fin-analyst", "dpo"],
                        "You are searching by phone number. State why you need to identify the holder of this number."),
    "cp-export": ("export.json", ["fin-analyst", "dpo"],
                  "You are about to export ontology data outside the platform. State the purpose and the recipient."),
    "cp-marking-remove": ("marking.remove", ["dpo"],
                          "You are about to remove a marking. Everything derived from this dataset will become visible to more roles. State the legal basis."),
    # Phase 2 (PHASE2_CONTRACT.md §4); the contract fixes only the danger-statement prompt.
    "cp-action-sensitive": ("action.execute", ["fin-analyst", "dpo"], None),
    "cp-danger-statement": ("expand.danger", ["patrol", "fin-analyst", "dpo"],
                            "Describe the concrete danger that justifies widening this analysis beyond the first hop."),
    "cp-exception": ("purpose.exception", ["fin-analyst", "dpo"], None),
}

HONESTY_IDS = ["inv.agent", "inv.investigations", "inv.analytics", "inv.map", "inv.object-types",
               "inv.properties", "inv.link-types", "inv.backing-datasets", "inv.objects", "inv.graph",
               "build.pipelines", "build.datasets", "build.lineage", "build.markings", "oversight.audit",
               "session.roles", "session.checkpoints",
               "inv.actions", "inv.karlsruhe", "build.resolution",
               "inv.leads", "inv.object-sets", "build.retention", "deployment"]
HONESTY_FIXED = {
    # Phase 3 replaced the rule-based stand-in with a scripted tool-calling agent (PHASE3_CONTRACT.md §2).
    "inv.agent": ("simplified", "Scripted stand-in for an AIP agent, with no language model: it plans tool calls from your question by fixed rules, "
                  "runs each call through your role, the purpose rules, Checkpoints and the audit log, cites the objects behind "
                  "its claims and stages edits for review. Real AIP agents use an LLM with tools; here the failures are scripted for teaching."),
    "build.lineage": ("extension", "Row- and field-level provenance goes beyond Foundry's dataset-level lineage."),
}
HONESTY_LABELS = {"mirrors": "Mirrors Foundry", "simplified": "Simplified", "extension": "Teaching extension"}


def research_source_urls():
    text = (REPO_ROOT / "context" / "PALANTIR_RESEARCH_2026-11-04.md").read_text(encoding="utf-8")
    section = text.split("## G. Sources", 1)[1]
    return {line[2:].strip() for line in section.splitlines() if line.startswith("- http")}


def _blocks(gotham, foundry):
    for which, seed in (("gotham", gotham), ("foundry", foundry)):
        for dataset in DATASETS:
            yield which, dataset, seed[dataset]["governance"]


def test_both_seeds_carry_identical_governance(gotham, foundry):
    reference = gotham["starter"]["governance"]
    for _which, _dataset, block in _blocks(gotham, foundry):
        assert block == reference


def test_markings_table(gotham, foundry):
    for _w, _d, block in _blocks(gotham, foundry):
        assert [m["id"] for m in block["markings"]] == ALL
        for m in block["markings"]:
            assert (m["label"], m["description"]) == MARKINGS[m["id"]]
            assert m["colour"].startswith("--mk-")
        assert len({m["colour"] for m in block["markings"]}) == len(ALL)
        assert next(m for m in block["markings"] if m["id"] == "HEALTH")["colour"] == "--mk-health"


def test_roles_table(gotham, foundry):
    for _w, _d, block in _blocks(gotham, foundry):
        assert [r["id"] for r in block["roles"]] == list(ROLES)
        for role in block["roles"]:
            expected = ROLES[role["id"]]
            got = (role["label"], role["markingsVisible"], role["purposes"],
                   role["canApprove"], role["canRemoveMarkings"], role["canOpenOversight"])
            assert got == expected, role["id"]
            assert role["description"]
        assert block["defaultRole"] == "fin-analyst"
        # Nobody but the DPO sees HEALTH.
        assert [r["id"] for r in block["roles"] if "HEALTH" in r["markingsVisible"]] == ["dpo"]


def test_purposes(gotham, foundry):
    for _w, _d, block in _blocks(gotham, foundry):
        assert [p["id"] for p in block["purposes"]] == PURPOSES
        assert all(p["label"] for p in block["purposes"])
        role_purposes = {p for r in block["roles"] for p in r["purposes"]}
        assert role_purposes <= set(PURPOSES)


def test_checkpoints_exact(gotham, foundry):
    for _w, _d, block in _blocks(gotham, foundry):
        assert [c["id"] for c in block["checkpoints"]] == list(CHECKPOINTS)
        for cp in block["checkpoints"]:
            trigger, allowed, prompt = CHECKPOINTS[cp["id"]]
            assert cp["trigger"] == trigger
            assert cp["allowedRoles"] == allowed
            assert cp["prompt"] == prompt if prompt is not None else cp["prompt"]
            assert isinstance(cp["requiresPurpose"], bool)
            assert cp["refusalText"].endswith("This attempt has been logged.")
        removal = next(c for c in block["checkpoints"] if c["id"] == "cp-marking-remove")
        assert removal["refusalText"] == "Your role cannot remove markings. This attempt has been logged."
        assert removal["minLength"] == 20
        purposeful = {c["id"] for c in block["checkpoints"] if c["requiresPurpose"]}
        assert purposeful == {"cp-export", "cp-marking-remove", "cp-action-sensitive", "cp-exception"}
        by_id = {c["id"]: c for c in block["checkpoints"]}
        assert by_id["cp-danger-statement"]["minLength"] == 30
        assert by_id["cp-exception"]["tag"] == "exception"


def test_honesty_entries(gotham, foundry):
    sources = research_source_urls()
    assert sources, "no URLs found in research report §G"
    for _w, _d, block in _blocks(gotham, foundry):
        assert [h["id"] for h in block["honesty"]] == HONESTY_IDS
        for h in block["honesty"]:
            assert h["kind"] in HONESTY_LABELS, h["id"]
            assert h["label"] == HONESTY_LABELS[h["kind"]], h["id"]
            assert h["title"] and h["text"], h["id"]
            if h["docUrl"] is not None:
                assert h["docUrl"] in sources, (h["id"], h["docUrl"])
                assert urlparse(h["docUrl"]).scheme == "https"
            if h["id"] in HONESTY_FIXED:
                assert (h["kind"], h["text"]) == HONESTY_FIXED[h["id"]]
        by_id = {h["id"]: h for h in block["honesty"]}
        assert by_id["build.markings"]["kind"] == "mirrors"
        assert by_id["session.checkpoints"]["kind"] == "mirrors"
        assert by_id["inv.objects"]["kind"] == "simplified"
        # Phase 2 surfaces
        assert by_id["inv.actions"]["kind"] == "mirrors" and "panels" in by_id["inv.actions"]["text"]
        assert by_id["inv.karlsruhe"]["kind"] == "extension"
        assert by_id["build.resolution"]["kind"] == "simplified" and "weighted sum" in by_id["build.resolution"]["text"]
        # Phase 3 surfaces (PHASE3_CONTRACT.md §1)
        assert by_id["inv.leads"]["kind"] == "simplified"
        assert "the formula is ours; ELITE's is not public" in by_id["inv.leads"]["text"]
        assert by_id["inv.object-sets"]["kind"] == "mirrors" and "object sets" in by_id["inv.object-sets"]["text"]
        assert by_id["build.retention"]["kind"] == "simplified"
        assert by_id["deployment"]["kind"] == "extension" and "Apollo" in by_id["deployment"]["text"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_checkpoint_roles_exist(gotham, dataset):
    block = gotham[dataset]["governance"]
    role_ids = {r["id"] for r in block["roles"]}
    for cp in block["checkpoints"]:
        assert set(cp["allowedRoles"]) <= role_ids
