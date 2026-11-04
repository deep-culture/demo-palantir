"""
pipeline/leads.py — the one address-confidence scorer for leads (F8,
PHASE3_CONTRACT.md §1).

Both seed builders call :func:`compute_leads` (Build through the transform
``pipeline/06_build_leads.py``, Investigate from ``scripts/build_ontology_seed.py``),
so ``catalog[ds].leads.items`` in the Investigate seed and the ``leads``
dataset in the Build seed hold the same leads.

The score
---------
One lead per Person with at least one address source.  Each source contributes
at most one component, its most recent usable record:

=========================  ==========  ======  ======================  =======================
source dataset             marking     weight  address used            date used
=========================  ==========  ======  ======================  =======================
clinic registrations       HEALTH      0.5     ``home_address``        ``registered_on``
mobile location pings      TELECOM     0.4     location label          latest ping ``timestamp``
company registry           OPEN        0.3     ``registered_address``  ``incorporation_date``
=========================  ==========  ======  ======================  =======================

    score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))

``ageDays`` is whole days between the record's date and ``asOf``, the latest
date found in the leads' input data (a fixed dataset date, so a rebuild gives
the same numbers).  The best address is the component with the largest
contribution.  :data:`FORMULA` is the exact string stored with each lead;
``tests/test_leads.py`` evaluates it against :func:`score`.

Which record counts
-------------------
* **Clinic:** the person's latest registration (rows attached by the shared
  resolver, name + date of birth only).
* **Pings:** the person's residential location if any ping is residential,
  otherwise the most frequently observed non-airport location (ties: the more
  recent last ping, then the label).  The date is the latest ping at that
  location.  A person seen only at airports has no ping component.
* **Registry:** the most recently incorporated company the person directs or
  beneficially owns.

Rounding: ``decay`` to 4 decimals, ``contribution`` (points, ``100 · weight ·
decay``) to 1 decimal, ``score`` to 1 decimal.  The browser recomputes the
score from the visible components with the same formula.
"""

from __future__ import annotations

import math
from datetime import date
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from pipeline import governance
from pipeline.resolution import PersonResolver, clinic_observations, normalize_name, person_observations

FORMULA = "score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))"
DECAY_DAYS = 365

# Contract table, in display order.  ``source`` is the Build dataset the
# component is read from; ``rawSource`` the raw file (Investigate's source id).
SOURCES: List[Dict[str, Any]] = [
    {"source": "norm_clinic_registrations", "rawSource": "clinic_registrations.csv",
     "label": "Clinic registration", "marking": "HEALTH", "weight": 0.5,
     "addressField": "home_address", "dateField": "registered_on"},
    {"source": "norm_mobile_pings", "rawSource": "mobile_location_pings.jsonl",
     "label": "Mobile location pings", "marking": "TELECOM", "weight": 0.4,
     "addressField": "location_label", "dateField": "timestamp"},
    {"source": "norm_company_registry", "rawSource": "company_registry.csv",
     "label": "Company registry", "marking": "OPEN", "weight": 0.3,
     "addressField": "registered_address", "dateField": "incorporation_date"},
]
# The company registry carries no coordinates.  A registered address takes the
# coordinates of the same place in the location data (clinic or ping rows);
# failing that, this small gazetteer of approximate street positions (the
# addresses are synthetic, the streets are real).  Like AIRPORT_COORDS in
# step 05, it is reference data, not a source dataset.
GAZETTEER: Dict[str, Tuple[float, float]] = {
    "5 Harbor Row, Limassol": (34.6712, 33.0436),
    "17 Kingsway, London": (51.5155, -0.1189),
    "9 Al Noor Park, Dubai": (25.1124, 55.2001),
    "48 Bahnhofstrasse, Zurich": (47.3707, 8.5392),
    "27 Ringstrasse, Vienna": (48.2046, 16.3652),
    "21 Rue des Acacias, Geneva": (46.1921, 6.1338),
    "12 Mariahilfer Strasse, Vienna": (48.1991, 16.3551),
    "6 Kirchgasse, Zurich": (47.3711, 8.5456),
    "14 Seabright Ave, Limassol": (34.6841, 33.0409),
    "88 Marina Free Zone, Dubai": (25.0805, 55.1403),
}
GAZETTEER_SOURCE = "pipeline/leads.py:GAZETTEER"

# Purpose of each source dataset (manifest values; HEALTH data is "healthcare").
_SOURCE_PURPOSE: Dict[str, str] = {
    spec["file"]: spec["purpose"] for spec in governance.SOURCE_DATASETS.values()
}

# Fields of a lead, for the Action drawer and the Close lead effects.  Leads
# are not ontology objects; ``outcome`` and ``closeReason`` exist only once
# the Close lead Action has run.
LEAD_PROPERTIES: List[Dict[str, str]] = [
    {"id": "id", "label": "Lead ID", "type": "string"},
    {"id": "personId", "label": "Person", "type": "string"},
    {"id": "address", "label": "Best address", "type": "string"},
    {"id": "lat", "label": "Latitude", "type": "float"},
    {"id": "lon", "label": "Longitude", "type": "float"},
    {"id": "score", "label": "Address confidence (0-100)", "type": "float"},
    {"id": "status", "label": "Status", "type": "string"},
    {"id": "outcome", "label": "Outcome", "type": "string"},
    {"id": "closeReason", "label": "Reason for closing", "type": "string"},
    {"id": "components", "label": "Score components", "type": "json"},
    {"id": "formula", "label": "Formula", "type": "string"},
    {"id": "asOf", "label": "As of", "type": "date"},
    {"id": "addressSource", "label": "Source of the best address", "type": "string"},
    {"id": "sourceMarkings", "label": "Markings of the sources", "type": "json"},
]
LEAD_PROPERTY_IDS: List[str] = [p["id"] for p in LEAD_PROPERTIES]

SOURCE_BY_ID: Dict[str, Dict[str, Any]] = {s["source"]: s for s in SOURCES}
WEIGHTS: Dict[str, float] = {s["source"]: s["weight"] for s in SOURCES}


# ---------------------------------------------------------------------------
# The score (one code path; the formula string above describes exactly this)
# ---------------------------------------------------------------------------

def decay(age_days: float) -> float:
    return math.exp(-age_days / DECAY_DAYS)


def score(components: Iterable[Mapping[str, Any]]) -> float:
    """``100 · min(1, Σ weight · exp(−ageDays / 365))``, unrounded."""
    total = sum(float(c["weight"]) * decay(float(c["ageDays"])) for c in components)
    return 100.0 * min(1.0, total)


def rounded_score(components: Iterable[Mapping[str, Any]]) -> float:
    return round(score(components), 1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _s(row: Mapping[str, Any], key: str) -> str:
    value = row.get(key, "")
    return "" if value is None else str(value).strip()


def _day(value: str) -> Optional[date]:
    value = (value or "").strip()[:10]
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _num(value: Any) -> Optional[float]:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _row_index(row: Mapping[str, Any], fallback: int) -> int:
    value = row.get("_source_row")
    return int(value) if value not in (None, "") else fallback


def dataset_as_of(
    clinic_rows: Sequence[Mapping[str, Any]],
    ping_rows: Sequence[Mapping[str, Any]],
    company_rows: Sequence[Mapping[str, Any]],
) -> str:
    """Latest date in the leads' input data (ISO ``YYYY-MM-DD``)."""
    days = [d for d in (
        [_day(_s(r, "registered_on")) for r in clinic_rows]
        + [_day(_s(r, "timestamp")) for r in ping_rows]
        + [_day(_s(r, "incorporation_date")) for r in company_rows]
    ) if d is not None]
    return max(days).isoformat() if days else ""


# ---------------------------------------------------------------------------
# Candidate records per person and source
# ---------------------------------------------------------------------------

class _Candidate:
    """One usable record (or ping location) for a person and source."""

    def __init__(self, source: str, address: str, day: date, lat: Optional[float], lon: Optional[float],
                 record: str, refs: List[Dict[str, Any]], address_ref: Dict[str, Any],
                 date_ref: Dict[str, Any], coord_refs: List[Dict[str, Any]], extra: Optional[Dict[str, Any]] = None):
        self.source = source
        self.address = address
        self.day = day
        self.lat = lat
        self.lon = lon
        self.record = record
        self.refs = refs              # every source cell this candidate reads
        self.address_ref = address_ref
        self.date_ref = date_ref
        self.coord_refs = coord_refs
        self.extra = extra or {}


def _ref(dataset: str, row: int, field: str, note: str = "") -> Dict[str, Any]:
    return {"dataset": dataset, "row": row, "field": field, "note": note}


def _clinic_candidates(resolver: PersonResolver, clinic_rows: Sequence[Mapping[str, Any]]) -> Dict[str, _Candidate]:
    """Latest attached clinic registration per person (file order breaks ties)."""
    ds = "norm_clinic_registrations"
    out: Dict[str, _Candidate] = {}
    for obs in clinic_observations(clinic_rows):
        pid = resolver.clinic_by_ref.get(obs.ref)
        row = obs.row
        day = _day(_s(row, "registered_on"))
        address = _s(row, "home_address")
        if not pid or day is None or not address:
            continue
        current = out.get(pid)
        if current is not None and day < current.day:
            continue
        i = obs.row_index
        out[pid] = _Candidate(
            ds, address, day, _num(row.get("lat")), _num(row.get("lon")), obs.ref,
            refs=[_ref(ds, i, "patient_name", "match"), _ref(ds, i, "dob", "match")],
            address_ref=_ref(ds, i, "home_address"), date_ref=_ref(ds, i, "registered_on"),
            coord_refs=[_ref(ds, i, "lat"), _ref(ds, i, "lon")],
        )
    return out


def _ping_candidates(resolver: PersonResolver, ping_rows: Sequence[Mapping[str, Any]]) -> Dict[str, _Candidate]:
    """Residential, else most frequent non-airport, ping location per person."""
    ds = "norm_mobile_pings"
    # person -> norm label -> {"count", "last": (day, ts, row, index), "residential"}
    seen: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for i, row in enumerate(ping_rows):
        label = _s(row, "location_label")
        loc_type = _s(row, "location_type")
        ts = _s(row, "timestamp")
        day = _day(ts)
        if not label or day is None or loc_type == "airport":
            continue
        ping_ref = f"ping:{_s(row, 'ping_id')}"
        pid = resolver.person_for(ping_ref, name=_s(row, "observed_name"), phone=_s(row, "phone_number"))
        if not pid:
            continue
        slot = seen.setdefault(pid, {}).setdefault(normalize_name(label), {
            "count": 0, "last": None, "residential": False, "label": label})
        slot["count"] += 1
        slot["residential"] = slot["residential"] or loc_type == "residential"
        idx = _row_index(row, i)
        if slot["last"] is None or ts > slot["last"][0]:
            slot["last"] = (ts, day, row, idx, ping_ref)
    out: Dict[str, _Candidate] = {}
    for pid, slots in seen.items():
        def rank(item: Tuple[str, Dict[str, Any]]) -> Tuple:
            key, slot = item
            return (not slot["residential"], -slot["count"], _neg_ts(slot["last"][0]), key)
        _key, best = sorted(slots.items(), key=rank)[0]
        ts, day, row, idx, ping_ref = best["last"]
        out[pid] = _Candidate(
            ds, best["label"], day, _num(row.get("lat")), _num(row.get("lon")), ping_ref,
            refs=[_ref(ds, idx, "phone_number", "match"), _ref(ds, idx, "observed_name", "match")],
            address_ref=_ref(ds, idx, "location_label", f"{best['count']} pings at this location"),
            date_ref=_ref(ds, idx, "timestamp", "latest ping at this location"),
            coord_refs=[_ref(ds, idx, "lat"), _ref(ds, idx, "lon")],
            extra={"pingCount": best["count"]},
        )
    return out


def _neg_ts(ts: str) -> Tuple[int, ...]:
    """Sort key that orders ISO timestamps newest first."""
    return tuple(-ord(ch) for ch in ts)


def _registry_candidates(
    resolver: PersonResolver,
    company_rows: Sequence[Mapping[str, Any]],
    coords: Mapping[str, Tuple[float, float, Dict[str, Any], Dict[str, Any]]],
) -> Dict[str, _Candidate]:
    """Most recently incorporated company each person directs or owns."""
    ds = "norm_company_registry"
    out: Dict[str, _Candidate] = {}
    for obs in person_observations([], company_rows, [], []):
        row = obs.row
        pid = resolver.person_for(obs.ref, name=obs.name, dob=obs.dob)
        day = _day(_s(row, "incorporation_date"))
        address = _s(row, "registered_address")
        if not pid or day is None or not address:
            continue
        current = out.get(pid)
        if current is not None and (day, address) <= (current.day, current.address):
            continue
        i = obs.row_index
        name_field = "director_name" if obs.kind == "director" else "beneficial_owner"
        dob_field = "director_dob" if obs.kind == "director" else "beneficial_owner_dob"
        lat = lon = None
        coord_refs: List[Dict[str, Any]] = []
        hit = coords.get(normalize_name(address))
        if hit:
            lat, lon, lat_ref, lon_ref = hit
            coord_refs = [lat_ref, lon_ref]
        elif address in GAZETTEER:
            lat, lon = GAZETTEER[address]
            coord_refs = [_ref(GAZETTEER_SOURCE, 0, "lat", "gazetteer"), _ref(GAZETTEER_SOURCE, 0, "lon", "gazetteer")]
        out[pid] = _Candidate(
            ds, address, day, lat, lon, obs.ref,
            refs=[_ref(ds, i, name_field, "match"), _ref(ds, i, dob_field, "match")],
            address_ref=_ref(ds, i, "registered_address", obs.kind),
            date_ref=_ref(ds, i, "incorporation_date"),
            coord_refs=coord_refs,
            extra={"companyId": _s(row, "company_id"), "role": obs.kind},
        )
    return out


def _known_coordinates(
    clinic_rows: Sequence[Mapping[str, Any]], ping_rows: Sequence[Mapping[str, Any]],
) -> Dict[str, Tuple[float, float, Dict[str, Any], Dict[str, Any]]]:
    """``{normalised address: (lat, lon, lat_ref, lon_ref)}`` from clinic and ping rows.

    The registry carries no coordinates; a registered address gets the
    coordinates of the same place in the location data (first row wins).
    """
    out: Dict[str, Tuple[float, float, Dict[str, Any], Dict[str, Any]]] = {}
    for ds, rows, field in (("norm_clinic_registrations", clinic_rows, "home_address"),
                            ("norm_mobile_pings", ping_rows, "location_label")):
        for i, row in enumerate(rows):
            key = normalize_name(_s(row, field))
            lat, lon = _num(row.get("lat")), _num(row.get("lon"))
            if key and lat is not None and lon is not None and key not in out:
                idx = _row_index(row, i)
                out[key] = (lat, lon, _ref(ds, idx, "lat", "same address"), _ref(ds, idx, "lon", "same address"))
    return out


# ---------------------------------------------------------------------------
# Leads
# ---------------------------------------------------------------------------

def _component(cand: _Candidate, as_of: date) -> Dict[str, Any]:
    spec = SOURCE_BY_ID[cand.source]
    age = max(0, (as_of - cand.day).days)
    d = decay(age)
    comp = {
        "source": cand.source,
        "marking": spec["marking"],
        "weight": spec["weight"],
        "ageDays": age,
        "decay": round(d, 4),
        "contribution": round(100.0 * spec["weight"] * d, 1),
        "address": cand.address,
        # Additions to the contract shape (see FOUNDRY_TECHNICAL_SPEC.md, leads):
        "label": spec["label"],
        "rawSource": spec["rawSource"],
        "purpose": _SOURCE_PURPOSE.get(spec["rawSource"], ""),
        "date": cand.day.isoformat(),
        "lat": cand.lat,
        "lon": cand.lon,
        "record": cand.record,
    }
    comp.update(cand.extra)
    return comp


def compute_leads(
    resolver: PersonResolver,
    clinic_rows: Sequence[Mapping[str, Any]],
    ping_rows: Sequence[Mapping[str, Any]],
    company_rows: Sequence[Mapping[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, List[Dict[str, Any]]]], str]:
    """``(leads, field_provenance_per_lead, asOf)``.

    ``resolver`` must be the shared resolver after the greedy pass *and*
    :func:`pipeline.resolution.attach_clinic_rows`.  Rows may be raw or
    normalised by step 01.  Leads are sorted by score (highest first), then
    person ID.
    """
    as_of_str = dataset_as_of(clinic_rows, ping_rows, company_rows)
    as_of = date.fromisoformat(as_of_str) if as_of_str else date.today()
    coords = _known_coordinates(clinic_rows, ping_rows)
    per_source = [
        _clinic_candidates(resolver, clinic_rows),
        _ping_candidates(resolver, ping_rows),
        _registry_candidates(resolver, company_rows, coords),
    ]
    person_ids = sorted({pid for cands in per_source for pid in cands})
    rows: List[Tuple[Dict[str, Any], Dict[str, List[Dict[str, Any]]]]] = []
    for pid in person_ids:
        cands = [c[pid] for c in per_source if pid in c]
        components = [_component(c, as_of) for c in cands]
        # Best address: largest contribution (contract order breaks ties).
        best_i = max(range(len(components)), key=lambda i: (components[i]["contribution"], -i))
        best, best_cand = components[best_i], cands[best_i]
        lead = {
            "id": f"lead::{pid}",
            "personId": pid,
            "address": best["address"],
            "lat": best["lat"],
            "lon": best["lon"],
            "score": rounded_score(components),
            "status": "open",
            "components": components,
            "formula": FORMULA,
            "asOf": as_of_str,
            "addressSource": best["source"],
            "sourceMarkings": governance.sort_markings(c["marking"] for c in components),
        }
        fp: Dict[str, List[Dict[str, Any]]] = {
            "personId": [ref for c in cands for ref in c.refs],
            "address": [best_cand.address_ref],
            "lat": best_cand.coord_refs[:1],
            "lon": best_cand.coord_refs[1:],
            "score": [c.date_ref for c in cands],
            "asOf": [],
        }
        for i, c in enumerate(cands):
            fp[f"components[{i}]"] = [c.address_ref, c.date_ref] + c.coord_refs
        rows.append((lead, fp))
    rows.sort(key=lambda r: (-r[0]["score"], r[0]["personId"]))
    return [r[0] for r in rows], [r[1] for r in rows], as_of_str


def leads_weights() -> List[Dict[str, Any]]:
    """The contract's weight table, as stored in both seeds."""
    return [{"source": s["source"], "rawSource": s["rawSource"], "label": s["label"],
             "marking": s["marking"], "weight": s["weight"],
             "addressField": s["addressField"], "dateField": s["dateField"]} for s in SOURCES]


def leads_block(
    resolver: PersonResolver,
    clinic_rows: Sequence[Mapping[str, Any]],
    ping_rows: Sequence[Mapping[str, Any]],
    company_rows: Sequence[Mapping[str, Any]],
) -> Dict[str, Any]:
    """``catalog[ds].leads`` for the Investigate seed: ``{asOf, formula, weights, items}``."""
    items, _fp, as_of = compute_leads(resolver, clinic_rows, ping_rows, company_rows)
    return {
        "objectType": "Lead",
        "asOf": as_of,
        "formula": FORMULA,
        "decayDays": DECAY_DAYS,
        "properties": [dict(p) for p in LEAD_PROPERTIES],
        "weights": leads_weights(),
        "items": items,
    }
