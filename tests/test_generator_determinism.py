"""Spec §5.2 / §6.5: the generator is deterministic and leaves Phase 0 files untouched."""

from __future__ import annotations

import json
import subprocess
import sys

import pytest

from conftest import REPO_ROOT

GENERATOR = REPO_ROOT / "scripts" / "generate_synthetic_sources.py"
LEGACY_FILES = ["watchlist.csv", "company_registry.csv", "flight_manifests.csv",
                "bank_transactions.csv", "mobile_location_pings.jsonl"]
NEW_FILES = ["clinic_registrations.csv", "manifest.json"]
PROFILES = ["starter", "simulator"]


def generate(profile, out, *extra):
    subprocess.run([sys.executable, str(GENERATOR), "--profile", profile, "--output", str(out), *extra],
                   cwd=REPO_ROOT, check=True, capture_output=True)
    return {p.name: p.read_bytes() for p in sorted(out.iterdir())}


@pytest.fixture(scope="module")
def runs(tmp_path_factory):
    out = {}
    for profile in PROFILES:
        a = generate(profile, tmp_path_factory.mktemp(f"{profile}_a"), "--seed", "20260401")
        b = generate(profile, tmp_path_factory.mktemp(f"{profile}_b"), "--seed", "20260401")
        default = generate(profile, tmp_path_factory.mktemp(f"{profile}_default"))
        other = generate(profile, tmp_path_factory.mktemp(f"{profile}_other"), "--seed", "7")
        out[profile] = (a, b, default, other)
    return out


@pytest.mark.parametrize("profile", PROFILES)
def test_same_seed_is_byte_identical(runs, profile):
    a, b, default, _ = runs[profile]
    assert sorted(a) == sorted(LEGACY_FILES + NEW_FILES)
    assert a == b
    assert a == default, "--seed default must be 20260401"


@pytest.mark.parametrize("profile", PROFILES)
def test_committed_files_match_a_fresh_run(runs, profile):
    """Every committed file — the Phase 0 ones and the new ones — is exactly what the generator writes."""
    a = runs[profile][0]
    committed = REPO_ROOT / "synthetic_data" / profile
    for name, data in a.items():
        assert (committed / name).read_bytes() == data, f"synthetic_data/{profile}/{name} differs from a fresh run"


@pytest.mark.parametrize("profile", PROFILES)
def test_seed_only_moves_clinic_data(runs, profile):
    a, _, _, other = runs[profile]
    for name in LEGACY_FILES:
        assert other[name] == a[name], f"--seed changed {name}"
    assert other["clinic_registrations.csv"] != a["clinic_registrations.csv"]


def _git_show(rev, rel):
    try:
        return subprocess.run(["git", "show", f"{rev}:{rel}"], cwd=REPO_ROOT,
                              capture_output=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        pytest.skip("git history not available")


# Rows Phase 2 appends (PHASE2_CONTRACT.md §1); everything before them is Phase 0.
PHASE2_APPENDED = {
    ("starter", "flight_manifests.csv"): ["MF-0007", "MF-0008", "MF-0009"],
    ("simulator", "flight_manifests.csv"): ["MF-0007", "MF-0008", "MF-0009", "MF-0101", "MF-0102", "MF-0103", "MF-0104"],
    ("starter", "bank_transactions.csv"): ["TX-0009", "TX-0010"],
    ("simulator", "bank_transactions.csv"): ["TX-0009", "TX-0010"],
    ("simulator", "company_registry.csv"): ["CO-201", "CO-202", "CO-203", "CO-204"],
    # Phase 3 (PHASE3_CONTRACT.md §1): the namesake's pings near home.
    ("starter", "mobile_location_pings.jsonl"): ["PG-0101", "PG-0102", "PG-0103"],
    ("simulator", "mobile_location_pings.jsonl"): ["PG-0101", "PG-0102", "PG-0103"],
}


def _row_id(line):
    if line.startswith("{"):
        return json.loads(line)["ping_id"]
    return line.split(",", 1)[0]


@pytest.mark.parametrize("rev", ["f7c485e", "4913daf"])  # before Phase 1, before Phase 2
def test_legacy_rows_unchanged(rev):
    """Every Phase 0 line is byte-identical; Phases 2 and 3 only append whole rows."""
    for profile in PROFILES:
        for name in LEGACY_FILES:
            rel = f"synthetic_data/{profile}/{name}"
            old = _git_show(rev, rel)
            new = (REPO_ROOT / rel).read_bytes()
            assert new.startswith(old), rel
            appended = [_row_id(line) for line in new[len(old):].decode("utf-8").splitlines()]
            assert appended == PHASE2_APPENDED.get((profile, name), []), rel


@pytest.mark.parametrize("profile,expected", [("starter", 10), ("simulator", 123)])
def test_clinic_row_counts(runs, profile, expected):
    text = runs[profile][0]["clinic_registrations.csv"].decode("utf-8")
    lines = text.strip().split("\n")
    assert lines[0] == ("registration_id,patient_name,dob,home_address,home_city,home_country,"
                        "lat,lon,clinic_code,registered_on,source")
    assert len(lines) - 1 == expected
    assert all(line.endswith(",clinic-ehr") for line in lines[1:])
