"""PHASE2_CONTRACT.md §3: Action types and external systems, both seeds.

The table is copied from the contract by hand.
"""

from __future__ import annotations

import re

import pytest

from conftest import DATASETS

# id: (label, objectType, allowedRoles, effect ops in order, writeback systems)
TABLE = {
    "act-add-to-watchlist": ("Add to watchlist", "Person", ["fin-analyst"],
                             ["setProperty", "createObject", "createLink", "writeback"], ["border-watch"]),
    "act-remove-from-watchlist": ("Remove from watchlist", "Person", ["fin-analyst"],
                                  ["setProperty", "deleteLinked", "writeback"], ["border-watch"]),
    "act-flag-account": ("Flag account for review", "BankAccount", ["fin-analyst"],
                         ["setProperty", "writeback"], ["bank-compliance"]),
    "act-request-border-watch": ("Request border watch", "Person", ["patrol", "fin-analyst"],
                                 ["writeback"], ["border-watch"]),
    "act-unmerge-person": ("Unmerge person", "Person", ["fin-analyst", "dpo"],
                           ["resolutionOverride", "writeback"], ["case-management"]),
}
SYSTEMS = [("border-watch", "Border watch system"), ("bank-compliance", "Bank compliance desk"),
           ("case-management", "Case management")]
VALUE = re.compile(r"^(param:[a-zA-Z]+|session:role|now|object:[a-zA-Z]+|value:.*)$")
PLACEHOLDER = re.compile(r"\{([a-zA-Z]+)\}")


def ontology(entry):
    return entry["ontology"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_identical_in_both_seeds(gotham, foundry, dataset):
    for key in ("actionTypes", "externalSystems"):
        assert gotham[dataset]["ontology"][key] == foundry[dataset]["ontology"][key]
    assert gotham[dataset]["ontology"]["actionTypes"] == gotham["starter"]["ontology"]["actionTypes"]


def test_table_exact(gotham):
    onto = ontology(gotham["starter"])
    assert [(s["id"], s["label"]) for s in onto["externalSystems"]] == SYSTEMS
    assert [a["id"] for a in onto["actionTypes"]] == list(TABLE)
    for action in onto["actionTypes"]:
        label, otype, roles, ops, systems = TABLE[action["id"]]
        assert action["label"] == label
        assert action["objectType"] == otype
        assert action["allowedRoles"] == roles
        assert [e["op"] for e in action["effects"]] == ops
        assert [e["system"] for e in action["effects"] if e["op"] == "writeback"] == systems
        assert action["honesty"] == "inv.actions"
        assert isinstance(action["sensitive"], bool) and isinstance(action["feedsAnalytics"], bool)
        assert action["description"]
    by_id = {a["id"]: a for a in onto["actionTypes"]}
    add = by_id["act-add-to-watchlist"]
    assert add["sensitive"] and add["feedsAnalytics"] and add["checkpointId"] == "cp-action-sensitive"
    assert add["effects"][0] == {"op": "setProperty", "property": "riskTag", "from": "param:riskTag"}
    assert add["effects"][1]["type"] == "WatchlistRecord"
    assert add["effects"][2] == {"op": "createLink", "linkType": "LISTED_ON", "target": "created:WatchlistRecord"}
    remove = by_id["act-remove-from-watchlist"]
    assert remove["effects"][0]["property"] == "riskTag" and remove["effects"][0]["onlyIfSetByAction"]
    assert remove["effects"][0]["refusal"]
    assert remove["effects"][1] == {"op": "deleteLinked", "linkType": "LISTED_ON", "targetType": "WatchlistRecord",
                                    "onlyCreatedByAction": True}
    assert by_id["act-flag-account"]["effects"][0]["property"] == "reviewFlag"
    unmerge = by_id["act-unmerge-person"]
    assert unmerge["effects"][0]["decision"] == "reject"


def test_effects_reference_valid_types_properties_and_systems(gotham):
    entry = gotham["starter"]
    onto = ontology(entry)
    props = {t["id"]: {p["id"] for p in t["properties"]} for t in onto["entityTypes"]}
    links = {r["id"]: (r["sourceType"], r["targetType"]) for r in onto["relationshipTypes"]}
    systems = {s["id"] for s in onto["externalSystems"]}
    block = entry["governance"]
    roles = {r["id"] for r in block["roles"]}
    checkpoints = {c["id"]: c for c in block["checkpoints"]}
    for action in onto["actionTypes"]:
        otype = action["objectType"]
        assert otype in props, action["id"]
        assert set(action["allowedRoles"]) <= roles
        params = {p["id"]: p for p in action["parameters"]}
        for p in action["parameters"]:
            assert p["type"] in ("string", "enum", "boolean")
            assert isinstance(p["required"], bool) and p["label"]
            if p["type"] == "enum":
                assert p["options"]
        if action["sensitive"]:
            assert action["checkpointId"] == "cp-action-sensitive"
        if action.get("checkpointId"):
            cp = checkpoints[action["checkpointId"]]
            assert set(action["allowedRoles"]) <= set(cp["allowedRoles"]), action["id"]
        created = {}
        for eff in action["effects"]:
            op = eff["op"]
            if op == "setProperty":
                assert eff["property"] in props[otype], (action["id"], eff)
                src = eff["from"]
                assert src.startswith("value:") or src[len("param:"):] in params, (action["id"], eff)
            elif op == "createObject":
                assert eff["type"] in props
                for key, value in eff["properties"].items():
                    assert key in props[eff["type"]], (action["id"], key)
                    assert VALUE.match(value), value
                    if value.startswith("param:"):
                        assert value[6:] in params
                    if value.startswith("object:"):
                        assert value[7:] in props[otype]
                created[eff["type"]] = True
            elif op == "createLink":
                src_type, tgt_type = links[eff["linkType"]]
                assert src_type == otype
                if eff["target"].startswith("created:"):
                    assert eff["target"][8:] in created and eff["target"][8:] == tgt_type
            elif op == "deleteLinked":
                assert links[eff["linkType"]] == (otype, eff["targetType"])
            elif op == "resolutionOverride":
                assert otype == "Person" and eff["candidateId"][6:] in params
            elif op == "writeback":
                assert eff["system"] in systems
                for name in PLACEHOLDER.findall(eff["template"]):
                    assert name in params or name in props[otype] or name in ("label", "role", "ts"), (action["id"], name)
            else:
                raise AssertionError(f"unknown op {op}")


def test_new_checkpoints(gotham):
    cps = {c["id"]: c for c in gotham["starter"]["governance"]["checkpoints"]}
    assert cps["cp-action-sensitive"]["trigger"] == "action.execute"
    assert cps["cp-action-sensitive"]["allowedRoles"] == ["fin-analyst", "dpo"]
    assert cps["cp-danger-statement"]["trigger"] == "expand.danger"
    assert cps["cp-danger-statement"]["allowedRoles"] == ["patrol", "fin-analyst", "dpo"]
    assert cps["cp-danger-statement"]["minLength"] == 30
    assert cps["cp-exception"]["trigger"] == "purpose.exception"
    assert cps["cp-exception"]["allowedRoles"] == ["fin-analyst", "dpo"]
    assert cps["cp-exception"]["requiresPurpose"] is True
