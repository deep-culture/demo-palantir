"""§6.2 seed contract: versioning metadata, Person resolution block, size."""

from __future__ import annotations

import json
import re
import shutil

import pytest

from conftest import DATASETS, FOUNDRY_VAR, GOTHAM_VAR, REPO_ROOT, parse_seed_js, persons
from pipeline.resolution import METHOD_CONFIDENCE, WEAK_METHODS
from pipeline.seedmeta import SCHEMA_VERSION, build_metadata, compute_build_id

BUILD_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
REF = re.compile(r"^(watchlist|flight|ping):[^:]+$|^company:[^:]+:(director|owner)$")
MAX_BYTES = 10 * 1024 * 1024
BUILDERS = {
    "gotham": REPO_ROOT / "scripts" / "build_ontology_seed.py",
    "foundry": REPO_ROOT / "scripts" / "build_foundry_seed.py",
}


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_metadata_block(request, which, dataset):
    meta = request.getfixturevalue(which)[dataset]["metadata"]
    assert SCHEMA_VERSION == 3
    assert meta["schemaVersion"] == 3
    assert BUILD_ID.match(meta["buildId"]), meta["buildId"]
    assert meta["generatedAt"]
    assert meta["builder"].startswith(BUILDERS[which].name + "@")
    assert set(meta["sources"]) == {
        "watchlist.csv", "company_registry.csv", "flight_manifests.csv",
        "bank_transactions.csv", "mobile_location_pings.jsonl",
        "clinic_registrations.csv", "manifest.json",
    }
    assert all(BUILD_ID.match(v) for v in meta["sources"].values())


@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_build_id_matches_fresh_computation(request, which):
    seed = request.getfixturevalue(which)
    for dataset in DATASETS:
        fresh = compute_build_id(REPO_ROOT / "synthetic_data" / dataset, BUILDERS[which])
        assert seed[dataset]["metadata"]["buildId"] == fresh["buildId"]
    assert seed["starter"]["metadata"]["buildId"] != seed["simulator"]["metadata"]["buildId"]


def test_build_id_stable_across_two_builds(tmp_path):
    import subprocess, sys
    ids = []
    for n in range(2):
        out = tmp_path / f"seed{n}.js"
        subprocess.run([sys.executable, str(BUILDERS["gotham"]), "--output", str(out)],
                       cwd=REPO_ROOT, check=True, capture_output=True)
        catalog = parse_seed_js(out, GOTHAM_VAR)
        ids.append({ds: catalog[ds]["metadata"]["buildId"] for ds in DATASETS})
    assert ids[0] == ids[1]


def test_build_id_ignores_crlf(tmp_path):
    src = REPO_ROOT / "synthetic_data" / "starter"
    crlf = tmp_path / "starter"
    crlf.mkdir()
    for path in src.iterdir():
        data = path.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
        (crlf / path.name).write_bytes(data)
    (crlf / ".DS_Store").write_bytes(b"\0junk")
    for builder in BUILDERS.values():
        assert compute_build_id(crlf, builder) == compute_build_id(src, builder)
        assert build_metadata(src, builder)["schemaVersion"] == 3


def test_build_id_changes_with_data(tmp_path):
    src = REPO_ROOT / "synthetic_data" / "starter"
    changed = tmp_path / "starter"
    shutil.copytree(src, changed)
    with (changed / "watchlist.csv").open("a", encoding="utf-8") as fh:
        fh.write("WL-9999,Test Person,,1970-01-01,Nowhere,Z0000000,test\n")
    assert compute_build_id(changed, BUILDERS["gotham"]) != compute_build_id(src, BUILDERS["gotham"])


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_every_person_has_resolution(request, which, dataset):
    entry = request.getfixturevalue(which)[dataset]
    people = persons(entry)
    assert people
    for person in people:
        res = person.get("resolution")
        assert isinstance(res, dict), person["id"]
        assert set(res) == {"method", "confidence", "mergedFrom", "splitRisk", "note"}, person["id"]
        assert res["method"] in METHOD_CONFIDENCE
        assert res["confidence"] == METHOD_CONFIDENCE[res["method"]]
        assert isinstance(res["mergedFrom"], list) and res["mergedFrom"], person["id"]
        assert all(REF.match(r) for r in res["mergedFrom"]), res["mergedFrom"]
        assert len(set(res["mergedFrom"])) == len(res["mergedFrom"])
        assert isinstance(res["splitRisk"], bool)
        assert isinstance(res["note"], str)
        if res["splitRisk"]:
            assert res["note"], person["id"]
        if res["method"] == "ping-only":
            assert all(r.startswith("ping:") for r in res["mergedFrom"])


def test_starter_split_risk_exhibits(gotham):
    flagged = {p["id"] for p in persons(gotham["starter"]) if p["resolution"]["splitRisk"]}
    names = {p["label"] for p in persons(gotham["starter"]) if p["id"] in flagged}
    # The five spec exhibits (REDESIGN_SPEC F0.2), both halves of each split.
    assert names == {"C. Silva", "Clara Silva", "E. Orlov", "Elias Orlov", "L. Demir", "Lena Demir",
                     "M. Singh", "Maya Singh", "C. Adler", "Clara Adler"}
    by_id = {p["id"]: p for p in persons(gotham["starter"])}
    note = by_id["person::c-silva-30131994523"]["resolution"]["note"]
    assert "C. Silva" in note and "Clara Silva (b. 1977-11-25)" in note
    assert by_id["person::p8842101"]["resolution"]["method"] == "passport"
    assert by_id["person::maya-singh-1992-09-21"]["resolution"]["method"] == "name+dob"


def test_foundry_resolved_persons_rows_carry_resolution(foundry):
    ds = next(d for d in foundry["starter"]["datasets"] if d["id"] == "resolved_persons")
    assert {"field": "resolution", "type": "json"} in ds["schema"]
    assert all("method" in row["resolution"] for row in ds["sampleRows"])


@pytest.mark.parametrize("dataset", DATASETS)
@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_governance_present_and_schema_unchanged(request, which, dataset):
    entry = request.getfixturevalue(which)[dataset]
    assert entry["metadata"]["schemaVersion"] == 3
    assert set(entry["governance"]) >= {"markings", "roles", "purposes", "checkpoints", "honesty"}


@pytest.mark.parametrize("which", ["gotham", "foundry"])
def test_seed_size_and_json(request, which):
    path = request.getfixturevalue(f"{which}_path")
    assert path.stat().st_size < MAX_BYTES, f"{path} is {path.stat().st_size} bytes"
    json.dumps(request.getfixturevalue(which))


@pytest.mark.parametrize(
    "rel, var, which",
    [("demo/seed.js", GOTHAM_VAR, "gotham"), ("foundry-demo/seed.js", FOUNDRY_VAR, "foundry")],
)
def test_committed_seed_is_current(rel, var, which):
    """The committed seed must be regenerated whenever its inputs change."""
    committed = parse_seed_js(REPO_ROOT / rel, var)
    for dataset in DATASETS:
        fresh = compute_build_id(REPO_ROOT / "synthetic_data" / dataset, BUILDERS[which])
        assert committed[dataset].get("metadata", {}).get("buildId") == fresh["buildId"], (
            f"{rel} is stale for {dataset}: run python3 {BUILDERS[which].relative_to(REPO_ROOT)} --output {rel}"
        )
