"""
pipeline/02_resolve_persons.py — Entity resolution for Person entities.

Resolution priority:
  1. passport_id (strong cross-source identifier)
  2. phone_number
  3. normalized canonical_name + dob
  4. alias lookup

For each resolved person, all contributing source rows from all five
datasets are recorded in the LineageRecord along with per-field provenance.

Output Dataset: person entities
  id               — person::{slug(passport_id or name-dob)}
  canonicalName
  aliases          — pipe-joined string of additional names
  dob
  nationality
  passportId
  phoneNumber
  riskTag
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.lib import Dataset, LineageRecord, slug


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _norm(value: str) -> str:
    """Lowercase + collapse non-alphanum runs → single space, trimmed."""
    cleaned = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


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
        # list of (dataset_name, source_row_idx, field, note)
        self.source_refs: List[Tuple[str, int, str, str]] = []
        # output_field → list of (dataset_name, source_row_idx, source_field, note)
        self.field_refs: Dict[str, List[Tuple[str, int, str, str]]] = {}

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
            self._add_field_ref("aliases", ds_name, ri, "observed_name", "ping alias")
        if row.get("phone_number"):
            self.phone_number = _merge(self.phone_number, row["phone_number"])
            self._add_field_ref("phoneNumber", ds_name, ri, "phone_number")

    def to_row(self) -> Dict[str, Any]:
        canonical = self.canonical_name or self.entity_id
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
# Resolver
# ---------------------------------------------------------------------------

class PersonResolver:
    def __init__(self) -> None:
        self._by_passport: Dict[str, str] = {}
        self._by_phone: Dict[str, str] = {}
        self._by_name_dob: Dict[str, str] = {}
        self._by_alias: Dict[str, str] = {}
        self._accums: Dict[str, _PersonAccum] = {}

    def _make_id(self, passport_id: str, name: str, dob: str, phone: str) -> str:
        if passport_id:
            return f"person::{slug(passport_id)}"
        key = f"{_norm(name)}-{dob or phone or 'person'}"
        return f"person::{slug(key)}"

    def _find_existing(self, passport_id: str, phone: str, name: str, dob: str) -> Optional[str]:
        if passport_id and passport_id in self._by_passport:
            return self._by_passport[passport_id]
        if phone and phone in self._by_phone:
            return self._by_phone[phone]
        norm = _norm(name)
        if norm and dob and f"{norm}|{dob}" in self._by_name_dob:
            return self._by_name_dob[f"{norm}|{dob}"]
        if norm and norm in self._by_alias:
            return self._by_alias[norm]
        return None

    def _register(self, accum: _PersonAccum, name: str, dob: str, passport_id: str, phone: str) -> None:
        eid = accum.entity_id
        if passport_id:
            self._by_passport[passport_id] = eid
        if phone:
            self._by_phone[phone] = eid
        norm = _norm(name)
        if norm and dob:
            self._by_name_dob[f"{norm}|{dob}"] = eid
        if norm:
            self._by_alias[norm] = eid
        for alias in accum.aliases:
            an = _norm(alias)
            if an:
                self._by_alias[an] = eid

    def get_or_create(self, name: str, dob: str = "", passport_id: str = "", phone: str = "") -> _PersonAccum:
        eid = self._find_existing(passport_id, phone, name, dob)
        if eid is None:
            eid = self._make_id(passport_id, name, dob, phone)
            accum = _PersonAccum(eid)
            self._accums[eid] = accum
        else:
            accum = self._accums[eid]
        # Register any newly available keys
        self._register(accum, name, dob, passport_id, phone)
        return accum

    def all_accums(self) -> List[_PersonAccum]:
        return list(self._accums.values())


# ---------------------------------------------------------------------------
# Main run function
# ---------------------------------------------------------------------------

def run(
    norm_watchlist: Dataset,
    norm_company_registry: Dataset,
    norm_flight_manifests: Dataset,
    norm_bank_transactions: Dataset,
    norm_mobile_pings: Dataset,
) -> Tuple[Dataset, LineageRecord]:
    resolver = PersonResolver()

    # --- Watchlist ---
    for row in norm_watchlist.rows:
        accum = resolver.get_or_create(
            row.get("canonical_name", ""),
            row.get("dob", ""),
            row.get("passport_id", ""),
        )
        accum.absorb_watchlist(row, norm_watchlist.name)

    # --- Company registry: directors and beneficial owners ---
    for row in norm_company_registry.rows:
        if row.get("director_name"):
            accum = resolver.get_or_create(row["director_name"], row.get("director_dob", ""))
            accum.absorb_company(row, norm_company_registry.name, "director")
        if row.get("beneficial_owner"):
            accum = resolver.get_or_create(row["beneficial_owner"], row.get("beneficial_owner_dob", ""))
            accum.absorb_company(row, norm_company_registry.name, "beneficial_owner")

    # --- Flight manifests ---
    for row in norm_flight_manifests.rows:
        accum = resolver.get_or_create(
            row.get("passenger_name", ""),
            row.get("dob", ""),
            row.get("passport_id", ""),
            row.get("phone_number", ""),
        )
        accum.absorb_flight(row, norm_flight_manifests.name)

    # --- Mobile pings (phone → person or alias) ---
    for row in norm_mobile_pings.rows:
        phone = row.get("phone_number", "")
        observed = row.get("observed_name", "")
        if phone or observed:
            accum = resolver.get_or_create(observed or "", phone=phone)
            accum.absorb_ping(row, norm_mobile_pings.name)

    # Build output dataset
    all_accums = resolver.all_accums()
    output_rows: List[Dict[str, Any]] = []
    fp_per_row: List[Dict[str, List[Dict[str, Any]]]] = []

    for accum in all_accums:
        output_rows.append(accum.to_row())
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
    ]

    ds = Dataset(name="resolved_persons", rows=output_rows, schema=schema)
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
    wl, cr, fm, bt, mp = norm_run(dataset_dir)
    ds, lineage = run(wl, cr, fm, bt, mp)
    print(f"Resolved {len(ds)} persons")
    for row in ds.rows[:5]:
        print(" ", row["id"], "—", row["canonicalName"])
