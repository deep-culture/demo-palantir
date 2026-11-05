"""PHASE3_CONTRACT.md §1 / spec F8: address-confidence leads, both seeds.

The contract table below is copied by hand.  The formula test evaluates the
*stored string* (``score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))``)
as an expression and checks it against the scorer in ``pipeline/leads.py``
and against every stored score (spec §4.8 acceptance).
"""

from __future__ import annotations

import json
import math
from datetime import date

import pytest

from conftest import DATASETS, REPO_ROOT, persons
from pipeline import leads as leads_mod

FORMULA = "score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))"
# source dataset: (marking, weight, raw file)
TABLE = {
    "norm_clinic_registrations": ("HEALTH", 0.5, "clinic_registrations.csv"),
    "norm_mobile_pings": ("TELECOM", 0.4, "mobile_location_pings.jsonl"),
    "norm_company_registry": ("OPEN", 0.3, "company_registry.csv"),
}
LEAD_KEYS = {"id", "personId", "address", "lat", "lon", "score", "status", "components", "formula", "asOf"}
COMPONENT_KEYS = {"source", "marking", "markings", "weight", "ageDays", "decay", "contribution", "address"}
# Fix round (FIXROUND_CONTRACT.md §1): every marking a role needs per component.
COMPONENT_MARKINGS = {
    "norm_clinic_registrations": ["PII", "HEALTH"],
    "norm_mobile_pings": ["TELECOM"],
    "norm_company_registry": ["OPEN"],   # ["OPEN", "PII"] when read from the beneficial-owner columns
}
ORDER = ["OPEN", "PII", "FIN", "TELECOM", "HEALTH", "LE-SENSITIVE"]
NAMESAKE = "person::g5510077"
WATCHLISTED = ("person::p8842101", "person::l1029921", "person::n5538219", "person::b7730042")
AS_OF = "2026-04-12"


# ---------------------------------------------------------------------------
# The formula string, evaluated
# ---------------------------------------------------------------------------

def formula_function(formula):
    """Turn the stored formula string into a function of the components.

    ``Σ <term>`` becomes ``sum(<term> for weight_i, ageDays_i in C)``; the term
    runs to the parenthesis that closes the enclosing call.
    """
    lhs, rhs = formula.split(" = ", 1)
    assert lhs == "score"
    expr = rhs.replace("−", "-").replace("·", "*")
    start = expr.index("Σ")
    depth, end = 0, None
    for i in range(start + 1, len(expr)):
        if expr[i] == "(":
            depth += 1
        elif expr[i] == ")":
            if depth == 0:
                end = i
                break
            depth -= 1
    term = expr[start + 1:end].strip()
    expr = expr[:start] + f"sum({term} for weight_i, ageDays_i in C)" + expr[end:]
    code = compile(expr, "<formula>", "eval")

    def evaluate(components):
        pairs = [(c["weight"], c["ageDays"]) for c in components]
        return eval(code, {"__builtins__": {}, "min": min, "sum": sum, "exp": math.exp, "C": pairs})
    return evaluate


def test_formula_string_is_the_code_path():
    assert leads_mod.FORMULA == FORMULA
    f = formula_function(FORMULA)
    cases = [
        [],
        [{"weight": 0.5, "ageDays": 0}],
        [{"weight": 0.5, "ageDays": 31}, {"weight": 0.4, "ageDays": 1}],
        [{"weight": 0.5, "ageDays": 0}, {"weight": 0.4, "ageDays": 0}, {"weight": 0.3, "ageDays": 0}],  # capped
        [{"weight": 0.3, "ageDays": 3650}],
    ]
    for comps in cases:
        assert f(comps) == pytest.approx(leads_mod.score(comps), abs=1e-9)
    assert leads_mod.score(cases[3]) == 100.0


@pytest.mark.parametrize("dataset", DATASETS)
def test_every_stored_score_matches_the_formula(gotham, dataset):
    block = gotham[dataset]["leads"]
    assert block["formula"] == FORMULA
    f = formula_function(block["formula"])
    for lead in block["items"]:
        assert lead["formula"] == FORMULA
        assert lead["score"] == round(f(lead["components"]), 1), lead["id"]
        assert lead["score"] == leads_mod.rounded_score(lead["components"]), lead["id"]
        for c in lead["components"]:
            exact = math.exp(-c["ageDays"] / 365)
            assert c["decay"] == round(exact, 4), lead["id"]
            assert c["contribution"] == round(100 * c["weight"] * exact, 1), lead["id"]


# ---------------------------------------------------------------------------
# Shape, components, markings, weights
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("dataset", DATASETS)
def test_block_shape_and_weights(gotham, dataset):
    block = gotham[dataset]["leads"]
    assert {"asOf", "formula", "weights", "items"} <= set(block)
    weights = {w["source"]: (w["marking"], w["weight"], w["rawSource"]) for w in block["weights"]}
    assert weights == TABLE
    assert [w["source"] for w in block["weights"]] == list(TABLE)
    assert {(w["addressField"], w["dateField"]) for w in block["weights"]} == {
        ("home_address", "registered_on"), ("location_label", "timestamp"),
        ("registered_address", "incorporation_date")}


@pytest.mark.parametrize("dataset", DATASETS)
def test_leads_and_components(gotham, dataset):
    entry = gotham[dataset]
    items = entry["leads"]["items"]
    person_ids = {p["id"] for p in persons(entry)}
    assert len({l["id"] for l in items}) == len(items)
    for lead in items:
        assert LEAD_KEYS <= set(lead), lead["id"]
        assert lead["id"] == f"lead::{lead['personId']}"
        assert lead["personId"] in person_ids
        assert lead["status"] == "open"
        assert 0 <= lead["score"] <= 100
        comps = lead["components"]
        assert 1 <= len(comps) <= 3
        assert len({c["source"] for c in comps}) == len(comps), "one component per source"
        assert [c["source"] for c in comps] == [s for s in TABLE if s in {c["source"] for c in comps}]
        for c in comps:
            assert COMPONENT_KEYS <= set(c)
            marking, weight, raw = TABLE[c["source"]]
            assert (c["marking"], c["weight"], c["rawSource"]) == (marking, weight, raw)
            expected = list(COMPONENT_MARKINGS[c["source"]])
            if c["source"] == "norm_company_registry" and c.get("role") == "owner":
                expected = ["OPEN", "PII"]
            assert c["markings"] == expected, (lead["id"], c["source"])
            assert isinstance(c["ageDays"], int) and c["ageDays"] >= 0
            assert c["address"]
            assert isinstance(c["lat"], float) and isinstance(c["lon"], float), (lead["id"], c["address"])
        assert all(c["purpose"] == "healthcare" for c in comps if c["marking"] == "HEALTH")
        # Best address = largest contribution.
        best = max(comps, key=lambda c: c["contribution"])
        assert lead["address"] == best["address"] and (lead["lat"], lead["lon"]) == (best["lat"], best["lon"])
        assert lead["addressSource"] == best["source"]
        assert lead["sourceMarkings"] == [m for m in ORDER if m in {m2 for c in comps for m2 in c["markings"]}]
    scores = [(-l["score"], l["personId"]) for l in items]
    assert scores == sorted(scores), "sorted by score, then person"


@pytest.mark.parametrize("dataset", DATASETS)
def test_no_health_component_for_watchlisted_people(gotham, dataset):
    """Clinic data covers no watchlisted person (spec §5.1): HEALTH can only reach their lead by a false merge."""
    by_person = {l["personId"]: l for l in gotham[dataset]["leads"]["items"]}
    for pid in WATCHLISTED:
        if pid in by_person:
            assert "HEALTH" not in {c["marking"] for c in by_person[pid]["components"]}, pid


# ---------------------------------------------------------------------------
# asOf and coverage
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("dataset", DATASETS)
def test_as_of_is_fixed(gotham, dataset):
    block = gotham[dataset]["leads"]
    assert block["asOf"] == AS_OF
    assert {l["asOf"] for l in block["items"]} == {AS_OF}
    # The latest date in the data, not the build date.
    pings = [json.loads(line) for line in
             (REPO_ROOT / "synthetic_data" / dataset / "mobile_location_pings.jsonl").read_text().splitlines() if line]
    assert max(p["timestamp"] for p in pings)[:10] == AS_OF
    for lead in block["items"]:
        for c in lead["components"]:
            assert (date.fromisoformat(AS_OF) - date.fromisoformat(c["date"])).days == c["ageDays"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_every_person_with_an_address_source_has_a_lead(gotham, dataset):
    """Worked out from the graph, independently of the scorer."""
    entry = gotham[dataset]
    ents = {e["id"]: e for e in entry["entities"]}
    expected = set()
    observed_at = {}
    for e in entry["edges"]:
        if e["type"] == "OBSERVED_AT" and ents[e["target"]]["properties"].get("locationType") != "airport":
            observed_at.setdefault(e["source"], set()).add(e["target"])
    for e in entry["edges"]:
        if e["type"] in ("RESIDES_AT", "DIRECTS", "BENEFICIALLY_OWNS"):
            expected.add(e["source"])
        if e["type"] == "USES_DEVICE" and observed_at.get(e["target"]):
            expected.add(e["source"])
    got = {l["personId"] for l in entry["leads"]["items"]}
    assert got == expected
    assert got <= {p["id"] for p in persons(entry)}


# ---------------------------------------------------------------------------
# The designed outcome (contract §1)
# ---------------------------------------------------------------------------

def _ranking(items, drop=()):
    f = formula_function(FORMULA)
    scored = [(round(f([c for c in l["components"] if c["marking"] not in drop]), 1), l["personId"]) for l in items]
    return sorted(scored, key=lambda s: (-s[0], s[1]))


def test_namesake_is_the_top_lead_only_with_health(gotham):
    items = gotham["starter"]["leads"]["items"]
    assert items[0]["personId"] == NAMESAKE
    full = _ranking(items)
    assert full[0][1] == NAMESAKE and full[0][0] > full[1][0]
    lead = items[0]
    assert {c["marking"] for c in lead["components"]} == {"HEALTH", "TELECOM"}
    assert lead["address"] == "41 Oak Lane, Birmingham"          # the clinic record's door number
    # As fin-analyst (no HEALTH): his score drops and he is no longer top.
    without = _ranking(items, drop=("HEALTH",))
    his = dict((pid, s) for s, pid in without)[NAMESAKE]
    assert his < lead["score"]
    assert without[0][1] != NAMESAKE
    visible = [c for c in lead["components"] if c["marking"] != "HEALTH"]
    assert max(visible, key=lambda c: c["contribution"])["address"] == "Oak Lane, Birmingham"   # street only


def test_namesake_has_a_lead_in_the_simulator(gotham):
    items = gotham["simulator"]["leads"]["items"]
    lead = next(l for l in items if l["personId"] == NAMESAKE)
    assert {c["marking"] for c in lead["components"]} == {"HEALTH", "TELECOM"}


# ---------------------------------------------------------------------------
# Build seed: transform, dataset, lineage
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("dataset", DATASETS)
def test_build_dataset_matches_investigate(gotham, foundry, dataset):
    entry = foundry[dataset]
    ds = next(d for d in entry["datasets"] if d["id"] == "leads")
    items = gotham[dataset]["leads"]["items"]
    assert ds["rowCount"] == len(items)
    assert 0 < len(ds["sampleRows"]) <= 50
    assert ds["sampleRows"] == items[:len(ds["sampleRows"])]
    assert ds["formula"] == FORMULA and ds["asOf"] == AS_OF
    assert ds["weights"] == gotham[dataset]["leads"]["weights"]
    assert ds["properties"] == gotham[dataset]["leads"]["properties"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_build_transform_and_governance(foundry, dataset):
    entry = foundry[dataset]
    transforms = {t["id"]: t for t in entry["pipeline"]["transforms"]}
    t = transforms["build_leads"]
    assert t["name"] == "06 Build Leads"
    assert t["output"] == "leads" and t["codePath"] == "pipeline/06_build_leads.py"
    assert set(t["inputs"]) == {"resolved_persons", "norm_clinic_registrations", "norm_mobile_pings",
                                "norm_company_registry"}
    assert "def run(" in t["code"]
    ds = next(d for d in entry["datasets"] if d["id"] == "leads")
    assert ds["producedBy"] == "build_leads" and set(ds["derivedFrom"]) == set(t["inputs"])
    assert {"HEALTH", "TELECOM", "OPEN"} <= set(ds["markings"])
    assert ds["markingProvenance"]["HEALTH"] == ["clinic_registrations.csv"]
    assert ds["markingProvenance"]["TELECOM"] == ["mobile_location_pings.jsonl"]
    assert "healthcare" in ds["inputPurposes"]                 # Karlsruhe R2 flags it
    assert ds["retentionDays"] == 180                          # shortest input (pings)
    by_id = {d["id"]: d for d in entry["datasets"]}
    for parent in t["inputs"]:
        assert "build_leads" in by_id[parent]["consumedBy"], parent


@pytest.mark.parametrize("dataset", DATASETS)
def test_build_row_lineage(foundry, dataset):
    ds = next(d for d in foundry[dataset]["datasets"] if d["id"] == "leads")
    assert list(ds["rowLineage"]) == [r["id"] for r in ds["sampleRows"]]
    for row in ds["sampleRows"]:
        lin = ds["rowLineage"][row["id"]]
        fp = lin["fieldProvenance"]
        assert {"id", "personId", "address", "lat", "lon", "score"} <= set(fp)
        assert fp["id"][0]["dataset"] == "resolved_persons" and fp["id"][0]["row"] >= 0
        assert [r["dataset"] for r in fp["address"]] == [row["addressSource"]]
        for i, comp in enumerate(row["components"]):
            refs = fp[f"components[{i}]"]
            assert refs[0]["dataset"] == comp["source"]
        datasets = {r["dataset"] for r in lin["sourceRows"]}
        assert "resolved_persons" in datasets
        assert {c["source"] for c in row["components"]} <= datasets


def test_scorer_is_deterministic():
    import importlib.util

    def load(stem):
        spec = importlib.util.spec_from_file_location(stem, REPO_ROOT / "pipeline" / f"{stem}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    s01, s02, s06 = load("01_normalize_sources"), load("02_resolve_persons"), load("06_build_leads")
    wl, cr, fm, bt, mp, cl = s01.run(REPO_ROOT / "synthetic_data" / "starter")
    persons_ds, _ = s02.run(wl, cr, fm, mp, cl)
    a, _ = s06.run(persons_ds, cl, mp, cr)
    b, _ = s06.run(persons_ds, cl, mp, cr)
    assert a.rows == b.rows and a.name == "leads"


@pytest.mark.parametrize("dataset", DATASETS)
def test_clinic_components_stay_withheld_without_pii(gotham, foundry, dataset):
    """After a HEALTH removal, a role without PII still cannot see a clinic
    component, so the namesake's score cannot regain it there."""
    seen = 0
    for lead in gotham[dataset]["leads"]["items"]:
        for c in lead["components"]:
            if c["source"] == "norm_clinic_registrations":
                seen += 1
                assert c["marking"] == "HEALTH" and c["markings"] == ["PII", "HEALTH"]
                assert not set(c["markings"]) <= {"OPEN", "HEALTH"}
    assert seen
    weights = {w["source"]: w for w in gotham[dataset]["leads"]["weights"]}
    assert weights["norm_clinic_registrations"]["markings"] == ["PII", "HEALTH"]
    assert weights["norm_clinic_registrations"]["marking"] == "HEALTH"
