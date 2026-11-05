"""
pipeline/candidates.py — cross-person candidate pairs with transparent scores
(F6, PHASE2_CONTRACT.md §2).

The greedy resolver in ``pipeline/resolution.py`` decides who is who in the
seed.  That is what the browser's **default threshold 0.75** means: every merge
the deterministic rules made is fixed in this build.  This module then looks
for pairs of *separate* Persons that might be the same individual and scores
each pair with a weighted sum that students can read and recompute by hand.
The browser merges every pair whose score is at or above the slider's
threshold (union-find), so lowering the threshold produces merges — true and
false — without a rebuild.

Scoring
-------
``score = clamp(sum of the weights of the signals that fire, 0, 1)``, rounded
to two decimals.  Of ``name-exact`` and ``surname+initial`` only the stronger
counts; ``name-translit`` is added on top when *another* pair of their names
matches only after transliteration (a second, independent spelling).  The
weights (``SIGNALS``):

====================  ======  ================================================
signal                weight  fires when
====================  ======  ================================================
``passport-exact``     +1.00  same passport number (the pipeline already
                              merges these, so no candidate carries it)
``name-exact``         +0.45  a name of one equals a name of the other after
                              folding case, punctuation and accents
                              (José = Jose, Yılmaz = Yilmaz)
``surname+initial``    +0.25  same surname and first initial (C. Silva ~
                              Clara Silva); only if ``name-exact`` does not fire
``name-translit``      +0.15  some pair of names is equal only after mapping
                              transliteration variants (Omar/Umar,
                              Karim/Kareem, Jelena/Elena, Petrova/Petrov)
``dob-exact``          +0.15  a shared date of birth
``dob-conflict``       −0.15  both have dates of birth and none is shared
``phone-exact``        +0.30  a shared phone number
``shared-route``       +0.10  both were booked on flights between the same
                              two airports (either direction)
``shared-address``     +0.20  both direct or own a company registered at the
                              same address (the open company register)
``same-nationality``   +0.05  the same nationality on the watchlist
====================  ======  ================================================

Two constraints fix the scale (both are tested):

* No candidate reaches 0.75, the default threshold.  The strongest pairs in
  the data are *true* duplicates the greedy pass split (same name and date of
  birth, e.g. "Maya Singh" b. 1992-09-21 twice): 0.45 + 0.15 = 0.60, or 0.70
  with a shared route.  So a matching date of birth may add at most 0.15.
* The **namesake pair** — the watchlisted Omar Rahman ``person::n5538219``
  and the Birmingham care worker ``person::g5510077`` — scores 0.55:
  name-exact 0.45 + shared-route 0.10 + name-translit 0.15 ("Umar Rahman" on
  one manifest) − dob-conflict 0.15.  Two different dates of birth are on
  screen and the pair still merges at 0.55.  **The penalty is too small**, and
  so is the reward for a matching date of birth: this scorer is driven by
  names.  That is the lesson.

What the scorer does not use
----------------------------
There is no passport-conflict signal: two different passport numbers do not
veto a merge (the namesake pair has two).  ``SIGNALS_NOTE`` puts that question
under the weights table instead of adding the signal, which would split the
designed case.

Clinic registrations (home addresses) are *not* a signal: they are HEALTH
data collected for care, and using them to decide identity would be the very
purpose shift the markings exist to stop.  Explanations never print a phone
or passport number, so a role that cannot see TELECOM data learns only that a
phone matched.  Each candidate lists the ``markings`` of the data its signals
came from.

Blocking
--------
A pair is scored only if the two Persons share a *block*: the same normalised
(accent-folded) surname, a phone number, or a company address.  Pairs scoring
below ``MIN_THRESHOLD`` (0.30, the slider's minimum) can never merge and are
dropped.  ``MAX_CANDIDATES`` caps the list (starter at most 40, simulator at
most 400; the tests check the real counts).

Ordering: ``left`` is the watchlisted member if exactly one is watchlisted,
else the lower-sorting ID.  The candidate ID is built from both Person IDs,
so it stays stable across rebuilds while the people stay the same (unmerge
overrides in the browser refer to it).
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Set, Tuple

from pipeline.resolution import PersonResolver, person_observations

# Shown under the weights table (FIXROUND_CONTRACT.md §1).  The signal is
# deliberately *not* added: a passport-conflict veto would split the designed
# namesake pair (two passports, merged at 0.55) and remove the lesson.
SIGNALS_NOTE = "There is no passport-conflict signal. Should two different passports veto a merge? Who decides?"

DEFAULT_THRESHOLD = 0.75
MIN_THRESHOLD = 0.30
MAX_CANDIDATES = {"starter": 40, "simulator": 400}

SIGNALS: List[Dict[str, Any]] = [
    {"id": "passport-exact", "weight": 1.00, "label": "Same passport number",
     "note": "Already merged by the pipeline's deterministic rules; never appears on a candidate.",
     "markings": ["PII"]},
    {"id": "name-exact", "weight": 0.45, "label": "Same name",
     "note": "Equal after folding case, punctuation and accents (José = Jose, Yılmaz = Yilmaz).",
     "markings": ["PII"]},
    {"id": "surname+initial", "weight": 0.25, "label": "Same surname and first initial",
     "note": "C. Silva ~ Clara Silva. Counts only when no name matches exactly.",
     "markings": ["PII"]},
    {"id": "name-translit", "weight": 0.15, "label": "Another spelling also matches",
     "note": "Some pair of their names is equal only after mapping spelling variants: Omar/Umar, Karim/Kareem, Jelena/Elena, Petrova/Petrov. Added on top of the other name signals.",
     "markings": ["PII"]},
    {"id": "dob-exact", "weight": 0.15, "label": "Same date of birth",
     "note": "At least one date of birth is shared.",
     "markings": ["PII"]},
    {"id": "dob-conflict", "weight": -0.15, "label": "Different dates of birth",
     "note": "Both have dates of birth and none is shared. Deliberately a small penalty: is it too small?",
     "markings": ["PII"]},
    {"id": "phone-exact", "weight": 0.30, "label": "Same phone number",
     "note": "A phone number appears for both (flights or pings). The number itself is not shown.",
     "markings": ["TELECOM"]},
    {"id": "shared-route", "weight": 0.10, "label": "Shared flight route",
     "note": "Both were booked between the same two airports, in either direction, on any date.",
     "markings": ["PII"]},
    {"id": "shared-address", "weight": 0.20, "label": "Shared company address",
     "note": "Both direct or own a company registered at the same address (open company register). Clinic home addresses are never used.",
     "markings": ["OPEN"]},
    {"id": "same-nationality", "weight": 0.05, "label": "Same nationality",
     "note": "Nationality as recorded on the watchlist.",
     "markings": ["LE-SENSITIVE"]},
]
WEIGHTS: Dict[str, float] = {s["id"]: s["weight"] for s in SIGNALS}
SIGNAL_BY_ID: Dict[str, Dict[str, Any]] = {s["id"]: s for s in SIGNALS}
NAME_SIGNALS = ("name-exact", "surname+initial", "name-translit")
_MARKING_ORDER = ["OPEN", "PII", "FIN", "TELECOM", "HEALTH", "LE-SENSITIVE"]

# Token-level transliteration variants -> one canonical spelling.
TRANSLIT: Dict[str, str] = {
    "umar": "omar", "omer": "omar",
    "karim": "kareem",
    "jelena": "elena", "yelena": "elena",
    "petrova": "petrov",
    "mohammed": "muhammad", "mohamed": "muhammad", "muhammed": "muhammad",
    "yusuf": "yousef", "youssef": "yousef",
}
# Letters NFKD does not decompose.
_EXTRA_FOLD = str.maketrans({"ı": "i", "ø": "o", "ł": "l", "đ": "d", "ß": "ss", "æ": "ae", "œ": "oe"})


def fold(value: str) -> str:
    """Accent-, case- and punctuation-folded name: 'José  Ferreira' -> 'jose ferreira'."""
    text = unicodedata.normalize("NFKD", str(value or "").lower().translate(_EXTRA_FOLD))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = re.sub(r"[^a-z0-9]+", " ", text).strip()
    return re.sub(r"\s+", " ", text)


def translit(folded: str) -> str:
    return " ".join(TRANSLIT.get(tok, tok) for tok in folded.split())


def surname(folded: str) -> str:
    tokens = folded.split()
    return tokens[-1] if len(tokens) >= 2 else ""


def _initial_key(folded: str) -> str:
    tokens = folded.split()
    return f"{tokens[0][0]} {tokens[-1]}" if len(tokens) >= 2 else ""


def _fmt(weight: float) -> str:
    return ("+" if weight >= 0 else "−") + f"{abs(weight):.2f}"


def _route_label(route: Tuple[str, str]) -> str:
    return f"{route[0]}–{route[1]}"


# ---------------------------------------------------------------------------
# Person features
# ---------------------------------------------------------------------------

class _Features:
    __slots__ = ("pid", "names", "dobs", "dob", "passports", "phones", "routes", "addresses",
                 "nationalities", "watchlisted", "label")

    def __init__(self, pid: str) -> None:
        self.pid = pid
        self.names: List[str] = []
        self.dobs: Set[str] = set()
        self.dob = ""
        self.passports: Set[str] = set()
        self.phones: Set[str] = set()
        self.routes: Dict[Tuple[str, str], str] = {}   # sorted pair -> "DEP–ARR" as first booked
        self.addresses: Dict[str, str] = {}      # folded -> display
        self.nationalities: Set[str] = set()
        self.watchlisted = False
        self.label = ""


def person_features(
    resolver: PersonResolver,
    watchlist_rows: Sequence[Mapping[str, Any]],
    company_rows: Sequence[Mapping[str, Any]],
    flight_rows: Sequence[Mapping[str, Any]],
    ping_rows: Sequence[Mapping[str, Any]],
) -> Dict[str, _Features]:
    """Per Person, the evidence the scorer may use, gathered from the records
    the resolver put into that Person (``resolver.by_ref``)."""
    feats: Dict[str, _Features] = {}
    for pid, record in resolver.records.items():
        f = _Features(pid)
        f.names = record.all_names()
        f.dobs = {d for d in record.dobs if d}
        f.dob = record.dob
        f.passports = set(record.passports)
        f.watchlisted = record.watchlisted
        f.label = record.display_name
        feats[pid] = f
    for obs in person_observations(watchlist_rows, company_rows, flight_rows, ping_rows):
        pid = resolver.by_ref.get(obs.ref)
        if pid is None:
            continue
        f = feats[pid]
        if obs.phone:
            f.phones.add(obs.phone)
        row = obs.row
        if obs.kind == "flight":
            dep = str(row.get("departure_airport", "") or "").strip()
            arr = str(row.get("arrival_airport", "") or "").strip()
            if dep and arr:
                f.routes.setdefault(tuple(sorted((dep, arr))), f"{dep}\u2013{arr}")  # type: ignore[arg-type]
        elif obs.kind in ("director", "owner"):
            address = str(row.get("registered_address", "") or "").strip()
            if address:
                f.addresses.setdefault(fold(address), address)
        elif obs.kind == "watchlist":
            nationality = str(row.get("nationality", "") or "").strip()
            if nationality:
                f.nationalities.add(nationality)
    return feats


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def name_signals(a: _Features, b: _Features) -> List[Tuple[str, str, str]]:
    """``[(signal, name of a, name of b)]``: the stronger of name-exact /
    surname+initial, then name-translit if some *other* pair of names matches
    only after transliteration.  Ties go to the first names in record order."""
    best: Optional[Tuple[str, str, str]] = None
    variant: Optional[Tuple[str, str, str]] = None
    for na in a.names:
        fa = fold(na)
        if not fa:
            continue
        for nb in b.names:
            fb = fold(nb)
            if not fb:
                continue
            if fa == fb:
                if best is None or best[0] != "name-exact":
                    best = ("name-exact", na, nb)
            elif translit(fa) == translit(fb):
                if variant is None:
                    variant = ("name-translit", na, nb)
            elif _initial_key(fa) and _initial_key(fa) == _initial_key(fb):
                if best is None:
                    best = ("surname+initial", na, nb)
    return [x for x in (best, variant) if x is not None]


def score_pair(a: _Features, b: _Features) -> Tuple[float, List[Tuple[str, float, str]]]:
    """``(score, [(signal, weight, plain-English part), ...])`` for one pair."""
    parts: List[Tuple[str, float, str]] = []
    if a.passports & b.passports:
        parts.append(("passport-exact", WEIGHTS["passport-exact"], "same passport number"))
    for sig, na, nb in name_signals(a, b):
        if sig == "name-exact":
            text = f"same name '{na}'" if na == nb else f"same name '{na}' / '{nb}'"
        elif sig == "name-translit":
            text = f"also spelled '{na}' / '{nb}'"
        else:
            text = f"same surname and initial '{na}' / '{nb}'"
        parts.append((sig, WEIGHTS[sig], text))
    if a.dobs and b.dobs:
        shared = sorted(a.dobs & b.dobs)
        if shared:
            parts.append(("dob-exact", WEIGHTS["dob-exact"], f"same date of birth {shared[0]}"))
        else:
            parts.append(("dob-conflict", WEIGHTS["dob-conflict"],
                          f"different dates of birth {a.dob} / {b.dob}"))
    if a.phones & b.phones:
        parts.append(("phone-exact", WEIGHTS["phone-exact"], "same phone number"))
    routes = sorted(set(a.routes) & set(b.routes))
    if routes:
        more = f" (and {len(routes) - 1} more)" if len(routes) > 1 else ""
        parts.append(("shared-route", WEIGHTS["shared-route"], f"shared route {a.routes[routes[0]]}{more}"))
    addresses = sorted(set(a.addresses) & set(b.addresses))
    if addresses:
        parts.append(("shared-address", WEIGHTS["shared-address"],
                      f"companies registered at {a.addresses[addresses[0]]}"))
    nat = sorted(a.nationalities & b.nationalities)
    if nat:
        parts.append(("same-nationality", WEIGHTS["same-nationality"], f"same nationality ({nat[0]})"))
    total = sum(w for _s, w, _t in parts)
    score = round(min(1.0, max(0.0, total)) + 1e-9, 2)
    return score, parts


def explain(parts: Sequence[Tuple[str, float, str]], score: float) -> str:
    """'Same name 'Omar Rahman' (+0.55), shared route LHR–IST (+0.15), … Score 0.55.'"""
    if not parts:
        return f"No signals. Score {score:.2f}."
    text = ", ".join(f"{t} ({_fmt(w)})" for _s, w, t in parts)
    return text[0].upper() + text[1:] + f". Score {score:.2f}."


def _blocks(feats: Mapping[str, _Features]) -> Dict[Tuple[str, str], str]:
    """``{(pid_a, pid_b): block}`` for every pair sharing a block (first block wins)."""
    index: Dict[str, Set[str]] = {}

    def add(key: str, pid: str) -> None:
        index.setdefault(key, set()).add(pid)

    for pid, f in feats.items():
        for name in f.names:
            sn = surname(fold(name))
            if sn:
                add(f"surname:{sn}", pid)
                tn = TRANSLIT.get(sn)
                if tn:
                    add(f"surname:{tn}", pid)
        for phone in f.phones:
            add(f"phone:{phone}", pid)
        for addr in f.addresses:
            add(f"address:{addr}", pid)
    pairs: Dict[Tuple[str, str], str] = {}
    for key in sorted(index):
        members = sorted(index[key])
        if key.startswith("phone:"):
            label = "phone"          # never put the number itself in the seed
        else:
            label = key
        for i, a in enumerate(members):
            for b in members[i + 1:]:
                pairs.setdefault((a, b), label)
    return pairs


def _markings(signals: Iterable[str]) -> List[str]:
    found: Set[str] = set()
    for sig in signals:
        found.update(SIGNAL_BY_ID[sig]["markings"])
    return [m for m in _MARKING_ORDER if m in found]


def _candidate_id(left: str, right: str) -> str:
    def tail(pid: str) -> str:
        return pid.split("::", 1)[-1]
    return f"cand-{tail(left)}--{tail(right)}"


def build_candidates(feats: Mapping[str, _Features], limit: Optional[int] = None) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for (a, b), block in _blocks(feats).items():
        if feats[b].watchlisted and not feats[a].watchlisted:
            left, right = b, a
        else:
            left, right = a, b
        score, parts = score_pair(feats[left], feats[right])
        if score < MIN_THRESHOLD:
            continue
        signals = [s for s, _w, _t in parts]
        out.append({
            "id": _candidate_id(left, right),
            "left": left,
            "right": right,
            "score": score,
            "signals": signals,
            "block": block,
            "explanation": explain(parts, score),
            "markings": _markings(signals),
        })
    out.sort(key=lambda c: (-c["score"], c["left"], c["right"]))
    if limit is not None:
        out = out[:limit]
    return out


def resolution_block(
    dataset_key: str,
    resolver: PersonResolver,
    watchlist_rows: Sequence[Mapping[str, Any]],
    company_rows: Sequence[Mapping[str, Any]],
    flight_rows: Sequence[Mapping[str, Any]],
    ping_rows: Sequence[Mapping[str, Any]],
) -> Dict[str, Any]:
    """The ``catalog[ds].resolution`` object written identically into both seeds."""
    feats = person_features(resolver, watchlist_rows, company_rows, flight_rows, ping_rows)
    limit = MAX_CANDIDATES.get(dataset_key, max(MAX_CANDIDATES.values()))
    return {
        "defaultThreshold": DEFAULT_THRESHOLD,
        "minThreshold": MIN_THRESHOLD,
        "fixedNote": ("Merges made by the pipeline's deterministic rules are fixed in this build — "
                      "see each person's resolution record."),
        # The note on the weights table; ``discussion`` holds the same string
        # (the contract allows either name).
        "note": SIGNALS_NOTE,
        "discussion": SIGNALS_NOTE,
        "signals": [
            {"id": s["id"], "weight": s["weight"], "label": s["label"], "note": s["note"], "markings": list(s["markings"])}
            for s in SIGNALS
        ],
        "candidates": build_candidates(feats, limit),
    }
