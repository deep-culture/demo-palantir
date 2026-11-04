"""PHASE1_CONTRACT.md §3: markings on every object, property and link, in both seeds.

The rule table is copied from the contract by hand.  Also checks the clinic
attachment rules (§4): clinic rows never create a Person and never change an
existing person's identity.
"""

from __future__ import annotations

import csv
import shutil
import subprocess
import sys

import pytest

from conftest import DATASETS, GOTHAM_VAR, REPO_ROOT, parse_seed_js, persons

OBJECT = {
    "Person": ["PII"], "Company": [], "BankAccount": ["FIN"], "Device": ["TELECOM"], "Flight": ["PII"],
    "Airport": [], "Location": [], "WatchlistRecord": ["LE-SENSITIVE"],
}
PROPERTY = {
    "Person": {"phoneNumber": ["TELECOM"], "riskTag": ["LE-SENSITIVE"], "passportId": ["PII"],
               "homeAddress": ["HEALTH"], "clinicCode": ["HEALTH"]},
    "Flight": {"paymentCardLast4": ["FIN"]},
}
LINK = {
    "OWNS_ACCOUNT": ["FIN"], "HAS_CORP_ACCOUNT": ["FIN"], "TRANSFERRED_TO": ["FIN"],
    "USES_DEVICE": ["TELECOM"], "OBSERVED_AT": ["TELECOM"], "LISTED_ON": ["LE-SENSITIVE"],
    "BOOKED_ON": ["PII"], "RESIDES_AT": ["HEALTH"],
}
REF_MARKING = {"watchlist": "LE-SENSITIVE", "company": "OPEN", "flight": "PII", "ping": "TELECOM"}
TYPE_SOURCE = {"Company": ["OPEN"], "BankAccount": ["FIN"], "Device": ["TELECOM"], "Flight": ["PII"],
               "Airport": ["PII"], "WatchlistRecord": ["LE-SENSITIVE"]}
LOCATION_EDGE = {"REGISTERED_AT": "OPEN", "OBSERVED_AT": "TELECOM", "RESIDES_AT": "HEALTH"}
ORDER = ["OPEN", "PII", "FIN", "TELECOM", "HEALTH", "LE-SENSITIVE"]


def ordered(ms):
    present = set(ms)
    return [m for m in ORDER if m in present]


def expected_source_markings(entity, edges):
    etype = entity["type"]
    if etype == "Person":
        ms = {REF_MARKING[r.split(":", 1)[0]] for r in entity["resolution"]["mergedFrom"]}
        if any(e["type"] == "RESIDES_AT" and e["source"] == entity["id"] for e in edges):
            ms.add("HEALTH")
        return ordered(ms)
    if etype == "Location":
        return ordered(LOCATION_EDGE[e["type"]] for e in edges
                       if e["target"] == entity["id"] and e["type"] in LOCATION_EDGE)
    return TYPE_SOURCE[etype]


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_object_and_property_markings(request, which, dataset):
    entry = request.getfixturevalue(which)[dataset]
    residential = {e["target"] for e in entry["edges"] if e["type"] == "RESIDES_AT"}
    edges_by_entity = {}
    for e in entry["edges"]:
        edges_by_entity.setdefault(e["source"], []).append(e)
        edges_by_entity.setdefault(e["target"], []).append(e)
    for entity in entry["entities"]:
        etype = entity["type"]
        expected = ["HEALTH"] if entity["id"] in residential else OBJECT[etype]
        assert entity["markings"] == expected, entity["id"]
        assert entity["propertyMarkings"] == PROPERTY.get(etype, {}), entity["id"]
        assert entity["sourceMarkings"] == expected_source_markings(entity, edges_by_entity.get(entity["id"], [])), entity["id"]
        assert set(entity["markings"]) <= set(entity["sourceMarkings"]) | {"PII"}, entity["id"]


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_link_markings(request, which, dataset):
    for edge in request.getfixturevalue(which)[dataset]["edges"]:
        assert edge["markings"] == LINK.get(edge["type"], []), edge["id"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_markings_identical_between_seeds(gotham, foundry, dataset):
    def view(entry):
        ents = {e["id"]: (e["markings"], e["propertyMarkings"], e["sourceMarkings"]) for e in entry["entities"]}
        edges = {(e["type"], e["source"], e["target"]): e["markings"] for e in entry["edges"]}
        return ents, edges
    assert view(gotham[dataset]) == view(foundry[dataset])


@pytest.mark.parametrize("dataset", DATASETS)
def test_residential_locations_and_resides_at(gotham, foundry, dataset):
    for entry in (gotham[dataset], foundry[dataset]):
        by_id = {e["id"]: e for e in entry["entities"]}
        resides = [e for e in entry["edges"] if e["type"] == "RESIDES_AT"]
        assert resides
        for edge in resides:
            assert by_id[edge["source"]]["type"] == "Person"
            loc = by_id[edge["target"]]
            assert loc["type"] == "Location" and loc["properties"]["locationType"] == "residential"
            assert set(edge["properties"]) == {"asOf", "source"}
            assert edge["properties"]["source"] == "clinic-ehr"
        # A residential Location is reached only through RESIDES_AT (no collision
        # with a registry or ping location that would hide it from other roles).
        residential = {e["target"] for e in resides}
        for edge in entry["edges"]:
            if edge["type"] != "RESIDES_AT":
                assert edge["source"] not in residential and edge["target"] not in residential, edge["id"]
        # The person's homeAddress is one of their residences (the latest).
        for person in persons(entry):
            home = person["properties"].get("homeAddress")
            mine = [e for e in resides if e["source"] == person["id"]]
            assert bool(home) == bool(mine), person["id"]
            if home:
                latest = max(mine, key=lambda e: e["properties"]["asOf"])
                assert by_id[latest["target"]]["properties"]["label"] == home, person["id"]
                assert person["properties"].get("clinicCode"), person["id"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_clinic_props_identical_between_seeds(gotham, foundry, dataset):
    def view(entry):
        return {p["id"]: (p["properties"].get("homeAddress"), p["properties"].get("clinicCode")) for p in persons(entry)}
    assert view(gotham[dataset]) == view(foundry[dataset])


def test_starter_core_people_have_homes(gotham):
    homes = {p["id"]: p["properties"].get("homeAddress") for p in persons(gotham["starter"])}
    # Phase 2 clinic rework: no watchlisted person has a clinic registration.
    for watchlisted in ("person::p8842101", "person::l1029921", "person::n5538219", "person::b7730042"):
        assert homes[watchlisted] is None, watchlisted
    assert homes["person::g5510077"] == "41 Oak Lane, Birmingham"          # the namesake Omar Rahman
    assert homes["person::daniel-wu-1985-06-14"] == "1210 Corcoran Street NW, Washington, D.C."
    assert homes["person::maya-singh-1992-09-21"] == "58 Rue de Carouge, Geneva"
    assert sum(1 for h in homes.values() if h) == 10


@pytest.fixture(scope="module")
def without_clinic(tmp_path_factory):
    """Gotham seed built from copies of the data with the clinic file removed."""
    root = tmp_path_factory.mktemp("noclinic")
    defs = []
    for dataset in DATASETS:
        dst = root / dataset
        shutil.copytree(REPO_ROOT / "synthetic_data" / dataset, dst)
        (dst / "clinic_registrations.csv").unlink()
        defs += ["--dataset", f"{dataset}={dst}"]
    out = root / "seed.js"
    subprocess.run([sys.executable, str(REPO_ROOT / "scripts" / "build_ontology_seed.py"), "--output", str(out), *defs],
                   cwd=REPO_ROOT, check=True, capture_output=True)
    return parse_seed_js(out, GOTHAM_VAR)


@pytest.mark.parametrize("dataset", DATASETS)
def test_clinic_rows_change_no_identity(gotham, without_clinic, dataset):
    """Clinic data adds residential Locations, RESIDES_AT links and two HEALTH
    properties, and nothing else: the same people with the same resolution."""
    with_c = {e["id"]: e for e in gotham[dataset]["entities"]}
    base = {e["id"]: e for e in without_clinic[dataset]["entities"]}
    assert set(base) <= set(with_c)
    added = set(with_c) - set(base)
    assert added and all(with_c[i]["type"] == "Location" and with_c[i]["markings"] == ["HEALTH"] for i in added)
    for pid, person in base.items():
        if person["type"] != "Person":
            continue
        new = with_c[pid]
        assert new["label"] == person["label"]
        assert new["resolution"] == person["resolution"]
        props = {k: v for k, v in new["properties"].items() if k not in ("homeAddress", "clinicCode")}
        assert props == person["properties"]
    base_edges = {(e["type"], e["source"], e["target"]) for e in without_clinic[dataset]["edges"]}
    new_edges = {(e["type"], e["source"], e["target"]) for e in gotham[dataset]["edges"]}
    assert base_edges <= new_edges
    assert {t for t, _s, _t in new_edges - base_edges} == {"RESIDES_AT"}


def test_unmatched_clinic_rows_create_nothing(gotham):
    """Simulator patients who appear in no other source stay in the clinic file only."""
    from pipeline.resolution import normalize_name
    rows = list(csv.DictReader((REPO_ROOT / "synthetic_data" / "simulator" / "clinic_registrations.csv").open()))
    known = set()
    for p in persons(gotham["simulator"]):
        names = [p["properties"]["canonicalName"]] + p["properties"].get("aliases", "").split(" | ")
        known.update(normalize_name(n) for n in names if n)
    unmatched = [r for r in rows if normalize_name(r["patient_name"]) not in known]
    assert len(unmatched) == 4
    resides = [e for e in gotham["simulator"]["edges"] if e["type"] == "RESIDES_AT"]
    assert len({(e["source"], e["target"]) for e in resides}) == len(resides)
    labels = {e["properties"].get("label") for e in gotham["simulator"]["entities"] if e["type"] == "Location"}
    residences_of_matched = {r["home_address"] for r in rows if r not in unmatched}
    for row in unmatched:
        if row["home_address"] not in residences_of_matched:
            assert row["home_address"] not in labels
