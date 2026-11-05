"""PHASE1_CONTRACT.md §4 / spec F2: dataset markings carry down lineage (union rule)."""

from __future__ import annotations

import json

import pytest

from conftest import DATASETS, REPO_ROOT
from pipeline.lib import Dataset, Transform, inherit_markings

ORDER = ["OPEN", "PII", "FIN", "TELECOM", "HEALTH", "LE-SENSITIVE"]
CLINIC = "clinic_registrations.csv"
# Every dataset downstream of the raw clinic dataset in the Build DAG
# (spec §4.2 said 7; this DAG has 5 since Phase 3 added leads — see FOUNDRY_TECHNICAL_SPEC).
HEALTH_DOWNSTREAM = {"norm_clinic_registrations", "resolved_persons", "ontology_entities", "ontology_edges",
                     "leads"}
MANIFEST_MARKINGS = {
    "watchlist.csv": ["LE-SENSITIVE"],
    "company_registry.csv": ["OPEN"],
    "flight_manifests.csv": ["PII"],
    "bank_transactions.csv": ["FIN"],
    "mobile_location_pings.jsonl": ["TELECOM"],
    CLINIC: ["PII", "HEALTH"],   # fix round: clinic rows are personal data as well as health data
}
MANIFEST_KEYS = {"file", "markings", "purpose", "legalBasis", "retentionDays", "asOf"}
# Optional field-level markings (fix round: WM and Sovim, beneficial owners).
FIELD_MARKINGS = {"company_registry.csv": {"beneficial_owner": ["PII"], "beneficial_owner_dob": ["PII"]}}
GOV_FIELDS = {"markings", "markingProvenance", "purpose", "legalBasis", "retentionDays", "derivedFrom"}


def ordered_union(lists):
    seen = set()
    for markings in lists:
        seen.update(markings)
    return [m for m in ORDER if m in seen]


def downstream_of(datasets, root):
    children = {}
    for ds in datasets:
        for parent in ds["derivedFrom"]:
            children.setdefault(parent, set()).add(ds["id"])
    out, stack = set(), [root]
    while stack:
        for child in children.get(stack.pop(), ()):
            if child not in out:
                out.add(child)
                stack.append(child)
    return out


@pytest.mark.parametrize("dataset", DATASETS)
def test_manifest_lists_six_datasets(dataset):
    manifest = json.loads((REPO_ROOT / "synthetic_data" / dataset / "manifest.json").read_text())
    assert {v["file"]: v["markings"] for v in manifest.values()} == MANIFEST_MARKINGS
    for entry in manifest.values():
        extra = {"fieldMarkings", "fieldNote"} if entry["file"] in FIELD_MARKINGS else set()
        assert set(entry) == MANIFEST_KEYS | extra
        if extra:
            assert entry["fieldMarkings"] == FIELD_MARKINGS[entry["file"]]
            assert "WM and Sovim" in entry["fieldNote"]
        assert (REPO_ROOT / "synthetic_data" / dataset / entry["file"]).exists()
        assert isinstance(entry["retentionDays"], int) and entry["retentionDays"] > 0
        assert entry["purpose"] and entry["legalBasis"] and entry["asOf"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_every_build_dataset_has_governance_fields(foundry, dataset):
    for ds in foundry[dataset]["datasets"]:
        assert GOV_FIELDS <= set(ds), ds["id"]
        assert ds["markings"] == [m for m in ORDER if m in ds["markings"]], ds["id"]
        assert set(ds["markingProvenance"]) == set(ds["markings"]), ds["id"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_union_rule_on_every_dataset(foundry, dataset):
    datasets = foundry[dataset]["datasets"]
    by_id = {d["id"]: d for d in datasets}
    for ds in datasets:
        if not ds["derivedFrom"]:
            # Raw dataset: markings from the manifest, provenance is itself.
            assert ds["producedBy"] == ""
            assert ds["markings"] == MANIFEST_MARKINGS[ds["id"]]
            assert ds["markingProvenance"] == {m: [ds["id"]] for m in ds["markings"]}
            continue
        parents = [by_id[p] for p in ds["derivedFrom"]]
        assert ds["markings"] == ordered_union(p["markings"] for p in parents), ds["id"]
        expected_prov = {}
        for p in parents:
            for m, srcs in p["markingProvenance"].items():
                expected_prov.setdefault(m, set()).update(srcs)
        assert {m: set(v) for m, v in ds["markingProvenance"].items()} == expected_prov, ds["id"]
        # Provenance always names raw datasets.
        for srcs in ds["markingProvenance"].values():
            assert all(not by_id[s]["derivedFrom"] for s in srcs), ds["id"]
        assert ds["retentionDays"] == min(p["retentionDays"] for p in parents), ds["id"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_derived_from_matches_dag(foundry, dataset):
    entry = foundry[dataset]
    transforms = {t["id"]: t for t in entry["pipeline"]["transforms"]}
    for ds in entry["datasets"]:
        if ds["producedBy"] and ds["producedBy"] != "normalize_sources":
            assert set(ds["derivedFrom"]) == set(transforms[ds["producedBy"]]["inputs"]), ds["id"]
        for parent in ds["derivedFrom"]:
            parent_ds = next(d for d in entry["datasets"] if d["id"] == parent)
            if parent_ds["derivedFrom"]:
                assert ds["producedBy"] in parent_ds["consumedBy"], (parent, ds["id"])


@pytest.mark.parametrize("dataset", DATASETS)
def test_health_reaches_every_downstream_dataset(foundry, dataset):
    datasets = foundry[dataset]["datasets"]
    downstream = downstream_of(datasets, CLINIC)
    assert downstream == HEALTH_DOWNSTREAM
    for ds in datasets:
        if ds["id"] in downstream or ds["id"] == CLINIC:
            assert "HEALTH" in ds["markings"], ds["id"]
            assert ds["markingProvenance"]["HEALTH"] == [CLINIC], ds["id"]
        else:
            assert "HEALTH" not in ds["markings"], ds["id"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_resolved_persons_does_not_inherit_fin(foundry, dataset):
    """Bank data is not an input of person resolution, so no FIN there."""
    ds = next(d for d in foundry[dataset]["datasets"] if d["id"] == "resolved_persons")
    assert ds["markings"] == ["OPEN", "PII", "TELECOM", "HEALTH", "LE-SENSITIVE"]
    assert "norm_bank_transactions" not in ds["derivedFrom"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_gotham_sources_carry_manifest_markings(gotham, dataset):
    sources = {s["id"]: s for s in gotham[dataset]["sources"]}
    assert set(sources) == set(MANIFEST_MARKINGS)
    for sid, src in sources.items():
        assert src["markings"] == MANIFEST_MARKINGS[sid]
        assert src["markingProvenance"] == {m: [sid] for m in src["markings"]}
        assert src["purpose"] and src["legalBasis"] and src["retentionDays"]


def test_gotham_and_foundry_raw_governance_agree(gotham, foundry):
    for dataset in DATASETS:
        g = {s["id"]: s for s in gotham[dataset]["sources"]}
        f = {d["id"]: d for d in foundry[dataset]["datasets"] if not d["derivedFrom"]}
        assert set(g) == set(f)
        for sid in g:
            for key in ("markings", "markingProvenance", "purpose", "legalBasis", "retentionDays", "asOf"):
                assert g[sid][key] == f[sid][key], (sid, key)
            assert g[sid].get("fieldMarkings") == f[sid].get("fieldMarkings") == FIELD_MARKINGS.get(sid), sid


@pytest.mark.parametrize("dataset", DATASETS)
def test_illustrative_legal_bases_name_the_cjeu_cases(dataset):
    """FIXROUND_CONTRACT.md §1: the PNR and company-register legal bases name
    the CJEU judgments that limit them."""
    manifest = json.loads((REPO_ROOT / "synthetic_data" / dataset / "manifest.json").read_text())
    pnr = manifest["flight_manifests"]["legalBasis"]
    for phrase in ("Ligue des droits humains", "C-817/19", "21 June 2022", "six months"):
        assert phrase in pnr, phrase
    reg = manifest["company_registry"]["legalBasis"]
    for phrase in ("WM and Sovim", "C-37/20", "22 November 2022", "PII"):
        assert phrase in reg, phrase
    assert "open by law" not in reg


@pytest.mark.parametrize("dataset", DATASETS)
def test_beneficial_owner_fields_marked_in_build(foundry, dataset):
    by_id = {d["id"]: d for d in foundry[dataset]["datasets"]}
    for did in ("company_registry.csv", "norm_company_registry"):
        assert by_id[did]["markings"] == ["OPEN"], did
        assert by_id[did]["fieldMarkings"] == FIELD_MARKINGS["company_registry.csv"], did
        assert by_id[did]["fieldNote"], did
        fields = {f["field"] if isinstance(f, dict) else f for f in by_id[did]["schema"]}
        assert set(by_id[did]["fieldMarkings"]) <= fields, did


def _raw(name, markings):
    ds = Dataset(name, [{"x": 1}])
    ds.markings = list(markings)
    ds.marking_provenance = {m: [name] for m in markings}
    ds.retention_days = 100 if name == "a" else 30
    ds.input_purposes = [f"p-{name}"]
    return ds


def test_transform_run_unions_markings():
    a = _raw("a", ["PII"])
    b = _raw("b", ["HEALTH", "OPEN"])
    out, _ = Transform("t", "join", [a, b], lambda x, y: ([{"z": 1}], [{}])).run()
    assert out.markings == ["OPEN", "PII", "HEALTH"]
    assert out.marking_provenance == {"OPEN": ["b"], "PII": ["a"], "HEALTH": ["b"]}
    assert out.derived_from == ["a", "b"]
    assert out.retention_days == 30
    assert out.input_purposes == ["p-a", "p-b"]
    # Chained: provenance still names the raw datasets.
    c = _raw("c", ["FIN"])
    out2, _ = Transform("t2", "join", [out, c], lambda x, y: ([], [])).run()
    assert out2.markings == ["OPEN", "PII", "FIN", "HEALTH"]
    assert out2.marking_provenance["HEALTH"] == ["b"]


def test_inherit_markings_of_unmarked_inputs_is_empty():
    out = inherit_markings(Dataset("o", []), [Dataset("i", [])])
    assert out.markings == [] and out.marking_provenance == {}
