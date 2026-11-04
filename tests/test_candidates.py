"""PHASE2_CONTRACT.md §2 / spec F6: cross-person candidate pairs with transparent scores."""

from __future__ import annotations

import re

import pytest

from conftest import DATASETS, persons
from pipeline import candidates as C

NAMESAKE = "person::g5510077"
WATCHLISTED_OMAR = "person::n5538219"
NAMESAKE_CANDIDATE = "cand-n5538219--g5510077"
SIM_PAIRS = {
    frozenset({"person::mehmet-y-lmaz-1983-05-17", "person::mehmet-yilmaz-1991-10-02"}),
    frozenset({"person::jos-ferreira-1979-07-30", "person::jose-ferreira-1986-01-11"}),
}
LIMITS = {"starter": 40, "simulator": 400}


def block(entry):
    return entry["resolution"]


def by_id(entry):
    return {c["id"]: c for c in block(entry)["candidates"]}


def watchlisted_ids(entry):
    return {e["source"] for e in entry["edges"] if e["type"] == "LISTED_ON"}


def resolve_at(entry, threshold, rejected=()):
    """Union-find over candidates scoring >= threshold, as core/resolution.js does."""
    parent = {p["id"]: p["id"] for p in persons(entry)}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for cand in block(entry)["candidates"]:
        if cand["score"] >= threshold and cand["id"] not in rejected:
            a, b = find(cand["left"]), find(cand["right"])
            if a != b:
                parent[max(a, b)] = min(a, b)
    clusters = {}
    for pid in parent:
        clusters.setdefault(find(pid), []).append(pid)
    listed = watchlisted_ids(entry)
    rep_of = {}
    for members in clusters.values():
        wl = sorted(m for m in members if m in listed)
        rep = wl[0] if wl else min(members)
        for m in members:
            rep_of[m] = rep
    return rep_of, clusters


@pytest.mark.parametrize("dataset", DATASETS)
def test_block_shape_and_identical_in_both_seeds(gotham, foundry, dataset):
    g, f = block(gotham[dataset]), block(foundry[dataset])
    assert g == f
    assert g["defaultThreshold"] == 0.75
    assert g["minThreshold"] == 0.30
    assert "fixed in this build" in g["fixedNote"]
    ids = [s["id"] for s in g["signals"]]
    assert len(ids) == len(set(ids))
    for s in g["signals"]:
        assert set(s) >= {"id", "weight", "label", "note"} and s["label"] and s["note"], s["id"]
    for cand in g["candidates"]:
        assert set(cand) >= {"id", "left", "right", "score", "signals", "block", "explanation"}


def test_signal_weights_are_the_documented_ones(gotham):
    weights = {s["id"]: s["weight"] for s in block(gotham["starter"])["signals"]}
    assert weights == C.WEIGHTS
    assert weights["passport-exact"] == 1.0
    assert weights["dob-conflict"] < 0
    assert all(w > 0 for sid, w in weights.items() if sid != "dob-conflict")
    for suggested in ("name-exact", "name-translit", "surname+initial", "dob-exact", "dob-conflict",
                      "phone-exact", "shared-route", "shared-address", "same-nationality"):
        assert suggested in weights


@pytest.mark.parametrize("dataset", DATASETS)
def test_score_is_the_clamped_sum_of_its_signals(gotham, dataset):
    entry = gotham[dataset]
    weights = {s["id"]: s["weight"] for s in block(entry)["signals"]}
    for cand in block(entry)["candidates"]:
        assert cand["signals"] and len(set(cand["signals"])) == len(cand["signals"]), cand["id"]
        assert set(cand["signals"]) <= set(weights), cand["id"]
        total = min(1.0, max(0.0, sum(weights[s] for s in cand["signals"])))
        assert cand["score"] == pytest.approx(round(total, 2), abs=1e-9), cand["id"]
        # The explanation names every contribution and the final score.
        for sid in cand["signals"]:
            w = weights[sid]
            shown = ("+" if w >= 0 else "−") + f"{abs(w):.2f}"
            assert f"({shown})" in cand["explanation"], (cand["id"], sid)
        assert cand["explanation"].endswith(f"Score {cand['score']:.2f}.")
        assert sum(1 for s in cand["signals"] if s in ("name-exact", "surname+initial")) <= 1


@pytest.mark.parametrize("dataset", DATASETS)
def test_no_candidate_reaches_the_default_threshold(gotham, dataset):
    res = block(gotham[dataset])
    for cand in res["candidates"]:
        assert cand["score"] < res["defaultThreshold"], cand
        assert cand["score"] >= res["minThreshold"], cand
        assert "passport-exact" not in cand["signals"], cand
    # So the default threshold reproduces the pipeline's Persons exactly.
    rep_of, _ = resolve_at(gotham[dataset], 0.75)
    assert all(rep == pid for pid, rep in rep_of.items())


@pytest.mark.parametrize("dataset", DATASETS)
def test_pairs_valid_unique_and_within_limits(gotham, dataset):
    entry = gotham[dataset]
    people = {p["id"] for p in persons(entry)}
    cands = block(entry)["candidates"]
    assert 0 < len(cands) <= LIMITS[dataset]
    # The cap never had to drop anything.
    assert len(cands) < LIMITS[dataset]
    assert len({c["id"] for c in cands}) == len(cands)
    assert len({frozenset((c["left"], c["right"])) for c in cands}) == len(cands)
    listed = watchlisted_ids(entry)
    for c in cands:
        assert c["left"] in people and c["right"] in people and c["left"] != c["right"], c["id"]
        # left is the watchlisted member when exactly one is watchlisted, else the lower ID.
        if (c["left"] in listed) != (c["right"] in listed):
            assert c["left"] in listed, c["id"]
        else:
            assert c["left"] < c["right"], c["id"]
    scores = [c["score"] for c in cands]
    assert scores == sorted(scores, reverse=True)


@pytest.mark.parametrize("dataset", DATASETS)
def test_blocking(gotham, dataset):
    """Same normalised surname, or a shared phone or company address."""
    entry = gotham[dataset]
    ents = {p["id"]: p for p in persons(entry)}

    def surnames(pid):
        p = ents[pid]["properties"]
        names = [p.get("canonicalName", "")] + [a for a in p.get("aliases", "").split(" | ") if a]
        out = set()
        for n in names:
            sn = C.surname(C.fold(n))
            if sn:
                out.update({sn, C.TRANSLIT.get(sn, sn)})
        return out

    for c in block(entry)["candidates"]:
        kind, _, value = c["block"].partition(":")
        assert kind in ("surname", "phone", "address"), c["block"]
        if kind == "surname":
            assert value in surnames(c["left"]) and value in surnames(c["right"]), c["id"]
        elif kind == "phone":
            assert value == "" and "phone-exact" in c["signals"]


@pytest.mark.parametrize("dataset", DATASETS)
def test_explanations_leak_no_identifiers_or_health_data(gotham, dataset):
    entry = gotham[dataset]
    ids = set()
    for p in persons(entry):
        for key in ("phoneNumber", "passportId"):
            if p["properties"].get(key):
                ids.add(p["properties"][key])
    homes = {e["properties"]["label"] for e in entry["entities"]
             if e["type"] == "Location" and e["properties"].get("locationType") == "residential"}
    for c in block(entry)["candidates"]:
        text = c["explanation"] + " " + c["block"]
        assert not re.search(r"\+\d{6,}", text), c["id"]
        assert not any(i in text for i in ids), c["id"]
        assert not any(h in text for h in homes), c["id"]
        assert "HEALTH" not in c.get("markings", [])


@pytest.mark.parametrize("dataset", DATASETS)
def test_namesake_pair(gotham, dataset):
    entry = gotham[dataset]
    cand = by_id(entry)[NAMESAKE_CANDIDATE]
    assert (cand["left"], cand["right"]) == (WATCHLISTED_OMAR, NAMESAKE)
    assert 0.50 <= cand["score"] < 0.60
    assert cand["score"] >= 0.55  # so it merges at 0.55
    assert "dob-conflict" in cand["signals"] and "name-exact" in cand["signals"]
    assert "shared-route" in cand["signals"]
    assert cand["block"] == "surname:rahman"
    text = cand["explanation"]
    assert "Same name 'Omar Rahman' (+0.45)" in text
    assert "different dates of birth 1984-08-19 / 1979-02-02 (−0.15)" in text
    assert "shared route LHR–IST (+0.10)" in text
    assert "'Umar Rahman'" in text
    # Without the dob-conflict penalty it would have scored higher: the penalty is applied and shown.
    weights = {s["id"]: s["weight"] for s in block(entry)["signals"]}
    assert cand["score"] == pytest.approx(sum(weights[s] for s in cand["signals"]))


@pytest.mark.parametrize("dataset", DATASETS)
def test_at_055_namesake_joins_watchlist_operators(gotham, dataset):
    entry = gotham[dataset]
    rep_of, clusters = resolve_at(entry, 0.55)
    assert rep_of[NAMESAKE] == WATCHLISTED_OMAR
    # Union of properties with the watchlisted member's riskTag winning:
    members = [p for p in persons(entry) if rep_of[p["id"]] == WATCHLISTED_OMAR]
    tags = {p["properties"].get("riskTag") for p in members if p["id"] in watchlisted_ids(entry)}
    assert tags == {"dual-use-broker"}
    # ...so the merged person is risk-tagged, which is what "Watchlist operators" filters on.
    assert any(p["id"] == NAMESAKE for p in members)
    # An unmerge override is honoured at every threshold.
    rep_of, _ = resolve_at(entry, 0.30, rejected={NAMESAKE_CANDIDATE})
    assert rep_of[NAMESAKE] != WATCHLISTED_OMAR
    # At 0.60 the namesake stays separate.
    rep_of, _ = resolve_at(entry, 0.60)
    assert rep_of[NAMESAKE] == NAMESAKE


def test_simulator_namesake_pairs(gotham):
    entry = gotham["simulator"]
    found = {frozenset((c["left"], c["right"])): c for c in block(entry)["candidates"]}
    for pair in SIM_PAIRS:
        cand = found[pair]
        assert 0.40 <= cand["score"] <= 0.70, cand
        assert "name-exact" in cand["signals"] and "dob-conflict" in cand["signals"], cand
    labels = {p["id"]: p["label"] for p in persons(entry)}
    for pair in SIM_PAIRS:
        a, b = sorted(pair)
        assert labels[a] != labels[b] and C.fold(labels[a]) == C.fold(labels[b])


def test_starter_split_exhibits_are_candidates(gotham):
    """Lowering the threshold also repairs the F0.2 split exhibits (true merges)."""
    found = {frozenset((c["left"], c["right"])): c for c in block(gotham["starter"])["candidates"]}
    assert frozenset({"person::maya-singh-1992-09-21", "person::i6117009"}) in found
    assert frozenset({"person::c-silva-30131994523", "person::clara-silva-1977-11-25"}) in found


def test_scorer_unit_cases():
    def feats(pid, names, dobs=(), passports=(), phones=(), routes=None, addresses=None):
        f = C._Features(pid)
        f.names = list(names)
        f.dobs = set(dobs)
        f.dob = max(dobs, key=len) if dobs else ""
        f.passports = set(passports)
        f.phones = set(phones)
        f.routes = routes or {}
        f.addresses = addresses or {}
        return f

    a = feats("a", ["Omar Rahman"], ["1984-08-19"], ["N1"])
    b = feats("b", ["Omar Rahman"], ["1984-08-19"], ["N1"])
    assert C.score_pair(a, b)[0] == 1.0          # passport matches score 1.0 (clamped)
    c = feats("c", ["Umar Rahman"], ["1979-02-02"])
    score, parts = C.score_pair(a, c)
    assert [p[0] for p in parts] == ["name-translit", "dob-conflict"]
    assert score == 0.0                           # 0.15 - 0.15
    assert C.fold("José  Ferreira") == C.fold("Jose Ferreira") == "jose ferreira"
    assert C.fold("Mehmet Yılmaz") == "mehmet yilmaz"
    assert C.translit("umar rahman") == "omar rahman"
