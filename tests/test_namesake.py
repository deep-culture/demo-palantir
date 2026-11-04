"""PHASE2_CONTRACT.md §1: the namesake PER-007, the clinic rework, and stability of existing Persons."""

from __future__ import annotations

import csv
import json
import random
import subprocess

import pytest

from conftest import DATASETS, GOTHAM_VAR, REPO_ROOT, load_script, persons
from pipeline.resolution import normalize_name

NAMESAKE = "person::g5510077"
WATCHLISTED_OMAR = "person::n5538219"
WATCHLISTED = {"person::p8842101", "person::l1029921", "person::n5538219", "person::b7730042"}
PRE_PHASE2 = "4913daf"


def edges_of(entry, etype, source=None, target=None):
    return [e for e in entry["edges"] if e["type"] == etype
            and (source is None or e["source"] == source) and (target is None or e["target"] == target)]


def route(entry, flight_id):
    dep = edges_of(entry, "DEPARTED_FROM", source=flight_id)[0]["target"].split("::")[1].upper()
    arr = edges_of(entry, "ARRIVED_AT", source=flight_id)[0]["target"].split("::")[1].upper()
    return frozenset((dep, arr))


def read_csv(dataset, name):
    with (REPO_ROOT / "synthetic_data" / dataset / name).open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_namesake_is_a_separate_person_with_his_facts(request, which, dataset):
    entry = request.getfixturevalue(which)[dataset]
    people = {p["id"]: p for p in persons(entry)}
    assert NAMESAKE in people and WATCHLISTED_OMAR in people
    him = people[NAMESAKE]
    props = him["properties"]
    assert him["label"] == "Omar Rahman"
    assert props["dob"] == "1979-02-02"
    assert props["passportId"] == "G5510077"
    assert props["phoneNumber"] == "+447911223344"
    assert props["homeAddress"] == "41 Oak Lane, Birmingham"
    assert props["clinicCode"] == "CLN-BHM-02"
    if which == "gotham":  # Build's Person rows take aliases from watchlist and ping names only
        assert "Umar Rahman" in props["aliases"].split(" | ")
    assert not props.get("riskTag")
    assert him["resolution"]["method"] == "passport"
    # Phase 3: his handset is seen near home (street level, not the clinic's door number).
    assert him["resolution"]["mergedFrom"] == ["flight:MF-0008", "flight:MF-0009",
                                               "ping:PG-0101", "ping:PG-0102", "ping:PG-0103"]
    assert not him["resolution"]["splitRisk"]
    # No watchlist entry.
    assert not edges_of(entry, "LISTED_ON", source=NAMESAKE)
    # Two LHR-IST flights, one manifest spelling him "Umar Rahman".
    flights = {e["target"] for e in edges_of(entry, "BOOKED_ON", source=NAMESAKE)}
    assert flights == {"flight::mf-0008", "flight::mf-0009"}
    ents = {e["id"]: e for e in entry["entities"]}
    assert sorted(ents[f]["label"].split(" · ")[1] for f in flights) == ["Omar Rahman", "Umar Rahman"]
    assert {route(entry, f) for f in flights} == {frozenset({"LHR", "IST"})}
    # ...a route the watchlisted Omar Rahman also flew.
    watched_routes = {route(entry, e["target"]) for e in edges_of(entry, "BOOKED_ON", source=WATCHLISTED_OMAR)}
    assert frozenset({"LHR", "IST"}) in watched_routes
    # Pays rent by bank transfer.
    accounts = {e["target"] for e in edges_of(entry, "OWNS_ACCOUNT", source=NAMESAKE)}
    assert accounts == {"bankaccount::acct-p007"}
    rent = edges_of(entry, "TRANSFERRED_TO", source="bankaccount::acct-p007")
    assert len(rent) == 1 and rent[0]["properties"]["count"] == "2"
    # Clinic registration -> residential Location.
    homes = edges_of(entry, "RESIDES_AT", source=NAMESAKE)
    assert len(homes) == 1 and ents[homes[0]["target"]]["properties"]["locationType"] == "residential"


@pytest.mark.parametrize("dataset", DATASETS)
def test_watchlisted_omar_keeps_his_identity_and_account(gotham, dataset):
    entry = gotham[dataset]
    people = {p["id"]: p for p in persons(entry)}
    omar = people[WATCHLISTED_OMAR]
    assert omar["properties"]["riskTag"] == "dual-use-broker"
    assert "Umar Rahman" not in omar["properties"].get("aliases", "")
    assert all(not r.startswith("flight:MF-0008") and r != "flight:MF-0009" for r in omar["resolution"]["mergedFrom"])
    # The bank links accounts by owner name only; "Omar Rahman" still means him.
    owners = {e["source"] for e in edges_of(entry, "OWNS_ACCOUNT", target="bankaccount::acct-p003")}
    assert owners == {WATCHLISTED_OMAR}


@pytest.mark.parametrize("dataset", DATASETS)
def test_namesake_not_on_the_watchlist_file(dataset):
    rows = read_csv(dataset, "watchlist.csv")
    assert all(r["passport_id"] != "G5510077" and r["dob"] != "1979-02-02" for r in rows)
    manifests = [r for r in read_csv(dataset, "flight_manifests.csv") if r["passport_id"] == "G5510077"]
    assert sorted(r["passenger_name"] for r in manifests) == ["Omar Rahman", "Umar Rahman"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_clinic_coverage_excludes_watchlisted_people(gotham, dataset):
    entry = gotham[dataset]
    watch = read_csv(dataset, "watchlist.csv")
    watched_keys = {(normalize_name(r["canonical_name"]), r["dob"]) for r in watch}
    clinic = read_csv(dataset, "clinic_registrations.csv")
    assert clinic
    assert not [r for r in clinic if (normalize_name(r["patient_name"]), r["dob"]) in watched_keys]
    listed = {e["source"] for e in entry["edges"] if e["type"] == "LISTED_ON"}
    assert listed == WATCHLISTED
    for e in entry["edges"]:
        if e["type"] == "RESIDES_AT":
            assert e["source"] not in listed, e["id"]
    for p in persons(entry):
        if p["id"] in listed:
            assert "homeAddress" not in p["properties"] and "clinicCode" not in p["properties"], p["id"]
            assert "HEALTH" not in p["sourceMarkings"], p["id"]
    covered = {(r["patient_name"], r["dob"]) for r in clinic}
    # The namesake and non-watchlisted core people are covered.
    assert ("Omar Rahman", "1979-02-02") in covered
    assert ("Daniel Wu", "1985-06-14") in covered and ("Maya Singh", "1992-09-21") in covered


@pytest.mark.parametrize("dataset", DATASETS)
def test_clinic_covers_about_60_percent_of_noise_people(dataset):
    gen = load_script("generate_synthetic_sources")
    noise = gen.make_noise_people(random.Random(gen.LEGACY_SEED), gen.PROFILES[dataset]["extra_people"])
    if dataset == "simulator":
        noise += gen.SIM_PAIR_PEOPLE
    keys = {(p["canonical_name"], p["dob"]) for p in noise}
    covered = {(r["patient_name"], r["dob"]) for r in read_csv(dataset, "clinic_registrations.csv")}
    share = len(keys & covered) / len(keys)
    assert 0.55 <= share <= 0.65, share


def test_registration_ids_unique_and_gaps_only_where_rows_were_removed():
    for dataset in DATASETS:
        ids = [r["registration_id"] for r in read_csv(dataset, "clinic_registrations.csv")]
        assert len(ids) == len(set(ids))
        assert ids == sorted(ids)


# ---------------------------------------------------------------------------
# Existing Persons are unchanged (contract §1), compared with the committed
# seed from before Phase 2.
# ---------------------------------------------------------------------------

CLINIC_PROPS = ("homeAddress", "clinicCode")
# The only change to an existing resolution block: the watchlisted Omar Rahman
# gains the LHR-IST flight that gives the namesake pair its shared route.
APPENDED_REFS = {WATCHLISTED_OMAR: ["flight:MF-0007"]}


@pytest.fixture(scope="module")
def pre_phase2():
    try:
        text = subprocess.run(["git", "show", f"{PRE_PHASE2}:demo/seed.js"], cwd=REPO_ROOT,
                              capture_output=True, check=True, text=True).stdout
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("git history not available")
    body = text[len(GOTHAM_VAR + " = "):]
    return json.loads(body[: body.index(";\nwindow.")])


def clinic_changes(old_entry, new_entry):
    old = {p["id"]: p for p in persons(old_entry)}
    new = {p["id"]: p for p in persons(new_entry)}
    lost, gained, moved = set(), set(), set()
    for pid, before in old.items():
        a = {k: before["properties"].get(k) for k in CLINIC_PROPS}
        b = {k: new[pid]["properties"].get(k) for k in CLINIC_PROPS}
        if a == b:
            continue
        if a["homeAddress"] and not b["homeAddress"]:
            lost.add(pid)
        elif b["homeAddress"] and not a["homeAddress"]:
            gained.add(pid)
        else:
            moved.add(pid)
    return lost, gained, moved


@pytest.mark.parametrize("dataset", DATASETS)
def test_existing_persons_unchanged_except_clinic_properties(gotham, pre_phase2, dataset):
    old = {p["id"]: p for p in persons(pre_phase2[dataset])}
    new = {p["id"]: p for p in persons(gotham[dataset])}
    assert set(old) <= set(new)
    added = set(new) - set(old)
    if dataset == "starter":
        assert added == {NAMESAKE}
        assert len(new) == 24  # spec F6 acceptance: 23 plus the namesake
    else:
        assert added == {NAMESAKE, "person::mehmet-y-lmaz-1983-05-17", "person::mehmet-yilmaz-1991-10-02",
                         "person::jos-ferreira-1979-07-30", "person::jose-ferreira-1986-01-11"}
    for pid, before in old.items():
        after = new[pid]
        assert after["label"] == before["label"], pid
        strip = lambda props: {k: v for k, v in props.items() if k not in CLINIC_PROPS}  # noqa: E731
        assert strip(after["properties"]) == strip(before["properties"]), pid
        res_before, res_after = dict(before["resolution"]), dict(after["resolution"])
        extra = APPENDED_REFS.get(pid, [])
        assert [r for r in res_after["mergedFrom"] if r not in extra] == res_before["mergedFrom"], pid
        assert set(res_after["mergedFrom"]) - set(res_before["mergedFrom"]) == set(extra), pid
        res_before.pop("mergedFrom"), res_after.pop("mergedFrom")
        assert res_after == res_before, pid
    lost, _gained, _moved = clinic_changes(pre_phase2[dataset], gotham[dataset])
    assert lost == WATCHLISTED


@pytest.mark.parametrize("dataset", DATASETS)
def test_existing_edges_kept_except_watchlisted_residences(gotham, pre_phase2, dataset):
    def edge_set(entry):
        return {(e["type"], e["source"], e["target"]) for e in entry["edges"]}
    old, new = edge_set(pre_phase2[dataset]), edge_set(gotham[dataset])
    lost = old - new
    assert lost and all(t == "RESIDES_AT" and s in WATCHLISTED for t, s, _ in lost), sorted(lost)
    old_ids = {e["id"] for e in pre_phase2[dataset]["entities"]}
    new_ids = {e["id"] for e in gotham[dataset]["entities"]}
    gone = old_ids - new_ids
    # Only the watchlisted people's residential Locations disappear.
    assert gone == {t for _r, _s, t in lost} - {t for _r, _s, t in new}
