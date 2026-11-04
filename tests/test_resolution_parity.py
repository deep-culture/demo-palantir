"""F0.1: both builders agree on every entity and every edge."""

from __future__ import annotations

import pytest

from conftest import DATASETS, persons


def edge_set(entry):
    return {(e["type"], e["source"], e["target"]) for e in entry["edges"]}


@pytest.mark.parametrize("dataset", DATASETS)
def test_entity_ids_identical(gotham, foundry, dataset):
    g = {e["id"] for e in gotham[dataset]["entities"]}
    f = {e["id"] for e in foundry[dataset]["entities"]}
    assert g == f, f"only Gotham: {sorted(g - f)[:5]}, only Foundry: {sorted(f - g)[:5]}"


@pytest.mark.parametrize("dataset", DATASETS)
def test_edge_sets_identical(gotham, foundry, dataset):
    g, f = edge_set(gotham[dataset]), edge_set(foundry[dataset])
    assert g == f, f"only Gotham: {sorted(g - f)[:5]}, only Foundry: {sorted(f - g)[:5]}"
    assert len(gotham[dataset]["edges"]) == len(foundry[dataset]["edges"])


@pytest.mark.parametrize("dataset", DATASETS)
def test_person_labels_and_resolution_identical(gotham, foundry, dataset):
    g = {p["id"]: p for p in persons(gotham[dataset])}
    f = {p["id"]: p for p in persons(foundry[dataset])}
    for pid in g:
        assert g[pid]["label"] == f[pid]["label"], pid
        assert g[pid]["resolution"] == f[pid]["resolution"], pid


def test_known_starter_edges(gotham, foundry):
    for seed in (gotham, foundry):
        edges = edge_set(seed["starter"])
        # The registry's Maya Singh (name+dob) directs Cedar Gate, not the passport holder.
        assert ("DIRECTS", "person::maya-singh-1992-09-21", "company::co-104") in edges
        assert ("BENEFICIALLY_OWNS", "person::clara-silva-1977-11-25", "company::nco-001") in edges
        # Account owners are linked against the fully resolved state, so ping-only
        # people observed under the owner's name get their account.
        assert ("OWNS_ACCOUNT", "person::n-costa-49306468299", "bankaccount::acct-np008") in edges


@pytest.mark.parametrize("dataset", DATASETS)
def test_merged_records_have_their_edges(gotham, dataset):
    """Each registry/flight/watchlist record in mergedFrom yields an edge from that person."""
    entry = gotham[dataset]
    edges = edge_set(entry)
    by_source = {}
    for src_type, src, _tgt in edges:
        by_source.setdefault((src_type, src), set()).add(_tgt)
    for person in persons(entry):
        for ref in person["resolution"]["mergedFrom"]:
            parts = ref.split(":")
            if parts[0] == "company":
                rel = "DIRECTS" if parts[2] == "director" else "BENEFICIALLY_OWNS"
                target = f"company::{parts[1].lower()}"
            elif parts[0] == "flight":
                rel, target = "BOOKED_ON", f"flight::{parts[1].lower()}"
            elif parts[0] == "watchlist":
                rel, target = "LISTED_ON", f"watchlistrecord::{parts[1].lower()}"
            else:
                continue
            assert target in by_source.get((rel, person["id"]), set()), (person["id"], ref)
