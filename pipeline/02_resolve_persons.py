"""
pipeline/02_resolve_persons.py — Entity resolution for Person entities.

Identity decisions are made by the shared resolver in
``pipeline/resolution.py`` (also used by the Gotham seed builder), with
priority:
  1. passport_id (strong cross-source identifier)
  2. phone_number
  3. normalized canonical_name + dob
  4. alias lookup (never onto a watchlisted person with a different passport,
     and a watchlisted person's names are never re-pointed to someone else)

This step adds what Foundry needs on top: for each resolved person, all
contributing source rows from the source datasets are recorded in the
LineageRecord along with per-field provenance.

Clinic registrations (Phase 1) are attached after the greedy pass by name +
dob only (``resolution.attach_clinic_rows``); they never create a Person.  The
latest registration supplies ``homeAddress`` and ``clinicCode`` (both marked
HEALTH).  Bank transactions are not an input: no bank field reaches a Person
row, so the output does not inherit FIN.

Output Dataset: person entities
  id               — person::{slug(passport_id or name-dob)}
  canonicalName    — longest name from a watchlist/registry/flight record;
                     for ping-only persons, the most frequent observed name
  aliases          — pipe-joined string of additional names
  dob
  nationality
  passportId
  phoneNumber
  riskTag
  homeAddress      — latest clinic registration (HEALTH)
  clinicCode       — latest clinic registration (HEALTH)
  resolution       — {method, confidence, mergedFrom, splitRisk, note}

The resolver itself is attached to the output dataset as
``dataset.resolver`` so step 05 links edges with the same lookups, and the
seed builder scores cross-person candidate pairs from it
(``pipeline/candidates.py``; the browser's Resolution tab merges them above a
threshold).
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.lib import Dataset, LineageRecord, inherit_markings
from pipeline.resolution import (
    PersonRecord, PersonResolver, attach_clinic_rows, latest_clinic_rows, person_observations,
)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _merge(a: str, b: str) -> str:
    """Prefer the longer non-empty string."""
    if not b:
        return a
    if not a:
        return b
    if a == b:
        return a
    return b if len(b) > len(a) else a


# ---------------------------------------------------------------------------
# Person accumulator
# ---------------------------------------------------------------------------

class _PersonAccum:
    def __init__(self, entity_id: str) -> None:
        self.entity_id = entity_id
        self.canonical_name: str = ""
        self.aliases: Set[str] = set()
        self.dob: str = ""
        self.nationality: str = ""
        self.passport_id: str = ""
        self.phone_number: str = ""
        self.risk_tag: str = ""
        self.home_address: str = ""
        self.clinic_code: str = ""
        # list of (dataset_name, source_row_idx, field, note)
        self.source_refs: List[Tuple[str, int, str, str]] = []
        # output_field → list of (dataset_name, source_row_idx, source_field, note)
        self.field_refs: Dict[str, List[Tuple[str, int, str, str]]] = {}
        # (dataset_name, source_row_idx, observed_name) for every named ping
        self.ping_names: List[Tuple[str, int, str]] = []

    def _add_field_ref(self, output_field: str, ds_name: str, row_idx: int, src_field: str, note: str = "") -> None:
        self.field_refs.setdefault(output_field, []).append((ds_name, row_idx, src_field, note))

    def absorb_watchlist(self, row: Dict[str, Any], ds_name: str) -> None:
        ri = int(row["_source_row"])
        self.source_refs.append((ds_name, ri, "", "watchlist"))
        if row.get("canonical_name"):
            if _merge(self.canonical_name, row["canonical_name"]) != self.canonical_name:
                self.canonical_name = _merge(self.canonical_name, row["canonical_name"])
            self._add_field_ref("canonicalName", ds_name, ri, "canonical_name")
        for alias in row.get("aliases", []):
            self.aliases.add(alias)
        if row.get("aliases"):
            self._add_field_ref("aliases", ds_name, ri, "alias", "pipe-split")
        if row.get("dob"):
            self.dob = _merge(self.dob, row["dob"])
            self._add_field_ref("dob", ds_name, ri, "dob")
        if row.get("nationality"):
            self.nationality = _merge(self.nationality, row["nationality"])
            self._add_field_ref("nationality", ds_name, ri, "nationality")
        if row.get("passport_id"):
            self.passport_id = row["passport_id"]
            self._add_field_ref("passportId", ds_name, ri, "passport_id")
        if row.get("risk_tag"):
            self.risk_tag = _merge(self.risk_tag, row["risk_tag"])
            self._add_field_ref("riskTag", ds_name, ri, "risk_tag")

    def absorb_company(self, row: Dict[str, Any], ds_name: str, role: str) -> None:
        ri = int(row["_source_row"])
        self.source_refs.append((ds_name, ri, "", role))
        name_field = "director_name" if role == "director" else "beneficial_owner"
        dob_field = "director_dob" if role == "director" else "beneficial_owner_dob"
        if row.get(name_field):
            self.canonical_name = _merge(self.canonical_name, row[name_field])
            self._add_field_ref("canonicalName", ds_name, ri, name_field)
        if row.get(dob_field):
            self.dob = _merge(self.dob, row[dob_field])
            self._add_field_ref("dob", ds_name, ri, dob_field)

    def absorb_flight(self, row: Dict[str, Any], ds_name: str) -> None:
        ri = int(row["_source_row"])
        self.source_refs.append((ds_name, ri, "", "flight-passenger"))
        if row.get("passenger_name"):
            self.canonical_name = _merge(self.canonical_name, row["passenger_name"])
            self._add_field_ref("canonicalName", ds_name, ri, "passenger_name")
        if row.get("dob"):
            self.dob = _merge(self.dob, row["dob"])
            self._add_field_ref("dob", ds_name, ri, "dob")
        if row.get("passport_id"):
            self.passport_id = row["passport_id"]
            self._add_field_ref("passportId", ds_name, ri, "passport_id")
        if row.get("phone_number"):
            self.phone_number = _merge(self.phone_number, row["phone_number"])
            self._add_field_ref("phoneNumber", ds_name, ri, "phone_number")

    def absorb_ping(self, row: Dict[str, Any], ds_name: str) -> None:
        ri = int(row["_source_row"])
        self.source_refs.append((ds_name, ri, "", "device-ping"))
        if row.get("observed_name"):
            self.aliases.add(row["observed_name"])
            self.ping_names.append((ds_name, ri, row["observed_name"]))
            self._add_field_ref("aliases", ds_name, ri, "observed_name", "ping alias")
        if row.get("phone_number"):
            self.phone_number = _merge(self.phone_number, row["phone_number"])
            self._add_field_ref("phoneNumber", ds_name, ri, "phone_number")

    def absorb_clinic(self, row: Dict[str, Any], ds_name: str, latest: bool) -> None:
        ri = int(row["_source_row"])
        self.source_refs.append((ds_name, ri, "", "clinic-registration"))
        if not latest:
            return
        if row.get("home_address"):
            self.home_address = row["home_address"]
            self._add_field_ref("homeAddress", ds_name, ri, "home_address", "latest registration")
        if row.get("clinic_code"):
            self.clinic_code = row["clinic_code"]
            self._add_field_ref("clinicCode", ds_name, ri, "clinic_code", "latest registration")

    def to_row(self, record: PersonRecord, resolution: Dict[str, Any]) -> Dict[str, Any]:
        canonical = record.display_name or self.canonical_name
        if record.name_is_weak and canonical:
            # No watchlist/registry/flight name: fall back to the most frequent
            # ping observed_name and say so in the field provenance (F0.3).
            self.field_refs["canonicalName"] = [
                (ds, row, "observed_name", "from ping observed_name (weak)")
                for ds, row, name in self.ping_names if name == canonical
            ]
        clean_aliases = sorted(a for a in self.aliases if a and a != canonical)
        return {
            "id": self.entity_id,
            "type": "Person",
            "canonicalName": canonical,
            "aliases": " | ".join(clean_aliases),
            "dob": self.dob,
            "nationality": self.nationality,
            "passportId": self.passport_id,
            "phoneNumber": self.phone_number,
            "riskTag": self.risk_tag,
            "homeAddress": self.home_address,
            "clinicCode": self.clinic_code,
            "resolution": resolution,
        }

    def to_field_provenance(self) -> Dict[str, List[Dict[str, Any]]]:
        result: Dict[str, List[Dict[str, Any]]] = {}
        for field, refs in self.field_refs.items():
            result[field] = [
                {"dataset": ds, "row": row, "field": src_f, "note": note}
                for ds, row, src_f, note in refs
            ]
        return result


# ---------------------------------------------------------------------------
# Main run function
# ---------------------------------------------------------------------------

def run(
    norm_watchlist: Dataset,
    norm_company_registry: Dataset,
    norm_flight_manifests: Dataset,
    norm_mobile_pings: Dataset,
    norm_clinic_registrations: Dataset,
) -> Tuple[Dataset, LineageRecord]:
    resolver = PersonResolver()
    accums: Dict[str, _PersonAccum] = {}

    # One greedy pass in canonical order: watchlist, registry directors and
    # owners, flight passengers, mobile pings (see pipeline/resolution.py).
    observations = person_observations(
        norm_watchlist.rows, norm_company_registry.rows,
        norm_flight_manifests.rows, norm_mobile_pings.rows,
    )
    for obs in observations:
        record = resolver.observe(obs)
        if record is None:
            continue
        accum = accums.setdefault(record.id, _PersonAccum(record.id))
        if obs.kind == "watchlist":
            accum.absorb_watchlist(obs.row, norm_watchlist.name)
        elif obs.kind == "director":
            accum.absorb_company(obs.row, norm_company_registry.name, "director")
        elif obs.kind == "owner":
            accum.absorb_company(obs.row, norm_company_registry.name, "beneficial_owner")
        elif obs.kind == "flight":
            accum.absorb_flight(obs.row, norm_flight_manifests.name)
        else:
            accum.absorb_ping(obs.row, norm_mobile_pings.name)

    # Clinic rows: attach by name + dob only, after every other record.
    attached = attach_clinic_rows(resolver, norm_clinic_registrations.rows)
    latest = latest_clinic_rows(attached)
    for obs, pid in attached:
        if pid is None:
            continue  # never create a Person from a clinic row alone
        accums[pid].absorb_clinic(obs.row, norm_clinic_registrations.name, latest[pid] is obs)

    # Build output dataset
    resolutions = resolver.resolutions()
    all_accums = [accums[pid] for pid in resolver.records]
    output_rows: List[Dict[str, Any]] = []
    fp_per_row: List[Dict[str, List[Dict[str, Any]]]] = []

    for accum in all_accums:
        output_rows.append(accum.to_row(resolver.records[accum.entity_id], resolutions[accum.entity_id]))
        fp_per_row.append(accum.to_field_provenance())

    schema = [
        {"field": "id", "type": "string"},
        {"field": "type", "type": "string"},
        {"field": "canonicalName", "type": "string"},
        {"field": "aliases", "type": "string"},
        {"field": "dob", "type": "date"},
        {"field": "nationality", "type": "string"},
        {"field": "passportId", "type": "string"},
        {"field": "phoneNumber", "type": "string"},
        {"field": "riskTag", "type": "string"},
        {"field": "homeAddress", "type": "string"},
        {"field": "clinicCode", "type": "string"},
        {"field": "resolution", "type": "json"},
    ]

    ds = Dataset(name="resolved_persons", rows=output_rows, schema=schema)
    inherit_markings(ds, [norm_watchlist, norm_company_registry, norm_flight_manifests,
                          norm_mobile_pings, norm_clinic_registrations])
    ds.resolver = resolver  # type: ignore[attr-defined]  # read by step 05
    lineage = LineageRecord()

    for out_idx, (accum, fp) in enumerate(zip(all_accums, fp_per_row)):
        # Row-level sources
        seen: Set[Tuple[str, int]] = set()
        for ds_name, row_idx, _field, note in accum.source_refs:
            key = (ds_name, row_idx)
            if key not in seen:
                seen.add(key)
                lineage.add_source(out_idx, ds_name, row_idx, note=note)
        # Field-level provenance
        for output_field, refs in fp.items():
            lineage.field_provenance.setdefault(out_idx, {})[output_field] = refs

    return ds, lineage


if __name__ == "__main__":
    from pipeline.p01_normalize_sources import run as norm_run
    dataset_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic_data/starter")
    wl, cr, fm, bt, mp, cl = norm_run(dataset_dir)
    ds, lineage = run(wl, cr, fm, mp, cl)
    print(f"Resolved {len(ds)} persons")
    for row in ds.rows[:5]:
        print(" ", row["id"], "—", row["canonicalName"])
