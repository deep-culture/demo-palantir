"""F0.3: no Person is named after its ID."""

from __future__ import annotations

import pytest

from conftest import DATASETS, persons


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_no_person_named_after_id(request, which, dataset):
    seed = request.getfixturevalue(which)
    for person in persons(seed[dataset]):
        name = person["properties"].get("canonicalName", "")
        assert name, person["id"]
        assert not name.startswith("person::"), person["id"]
        assert not person["label"].startswith("person::"), person["id"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_resolved_persons_rows_named(foundry, dataset):
    ds = next(d for d in foundry[dataset]["datasets"] if d["id"] == "resolved_persons")
    for row in ds["sampleRows"]:
        assert not row["canonicalName"].startswith("person::"), row["id"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_ping_only_names_marked_weak(foundry, dataset):
    entry = foundry[dataset]
    ping_only = [p for p in persons(entry) if p["resolution"]["method"] == "ping-only"]
    assert ping_only, "expected at least one ping-only person"
    for person in ping_only:
        refs = entry["lineage"][person["id"]]["fieldProvenance"]["canonicalName"]
        assert refs and all(r["note"] == "from ping observed_name (weak)" for r in refs), person["id"]
        assert all(r["field"] == "observed_name" for r in refs)


def test_starter_ping_only_names(gotham):
    by_id = {p["id"]: p for p in persons(gotham["starter"])}
    # Most frequent observed name; ties go to the first one seen.
    assert by_id["person::c-silva-30131994523"]["label"] == "C. Silva"
    assert by_id["person::e-orlov-33919795579"]["label"] == "E. Orlov"
    assert by_id["person::n-costa-49306468299"]["label"] == "N. Costa"
    assert by_id["person::tomas-orlov-971106977991"]["label"] == "Tomas Orlov"
