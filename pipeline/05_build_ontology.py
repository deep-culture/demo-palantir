"""
pipeline/05_build_ontology.py — Build the full ontology entity and edge sets.

Takes all resolved entity datasets + normalized sources.  Produces:
  - Additional entity types: Device, Flight, Airport, Location, WatchlistRecord
  - All edges:
      LISTED_ON, DIRECTS, BENEFICIALLY_OWNS, REGISTERED_AT,
      OWNS_ACCOUNT, HAS_CORP_ACCOUNT, TRANSFERRED_TO,
      BOOKED_ON, DEPARTED_FROM, ARRIVED_AT,
      USES_DEVICE, OBSERVED_AT

Returns:
  entities_dataset  — all entities (persons + companies + accounts + new types)
  edges_dataset     — all edges
  entity_lineage    — LineageRecord for entities
  edge_lineage      — LineageRecord for edges
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.lib import Dataset, LineageRecord, slug

# ---------------------------------------------------------------------------
# Airport reference data (from build_ontology_seed.py)
# ---------------------------------------------------------------------------
AIRPORT_COORDS: Dict[str, Dict[str, Any]] = {
    "ATH": {"name": "Athens International Airport", "city": "Athens", "country": "Greece", "lat": 37.9364, "lon": 23.9475},
    "BEG": {"name": "Belgrade Nikola Tesla Airport", "city": "Belgrade", "country": "Serbia", "lat": 44.8184, "lon": 20.3091},
    "DXB": {"name": "Dubai International Airport", "city": "Dubai", "country": "United Arab Emirates", "lat": 25.2532, "lon": 55.3657},
    "IAD": {"name": "Washington Dulles International Airport", "city": "Washington, D.C.", "country": "United States", "lat": 38.9531, "lon": -77.4565},
    "IST": {"name": "Istanbul Airport", "city": "Istanbul", "country": "Turkey", "lat": 41.2753, "lon": 28.7519},
    "LCA": {"name": "Larnaca International Airport", "city": "Larnaca", "country": "Cyprus", "lat": 34.8751, "lon": 33.6249},
    "LHR": {"name": "Heathrow Airport", "city": "London", "country": "United Kingdom", "lat": 51.4700, "lon": -0.4543},
    "SOF": {"name": "Sofia Airport", "city": "Sofia", "country": "Bulgaria", "lat": 42.6950, "lon": 23.4062},
    "VIE": {"name": "Vienna International Airport", "city": "Vienna", "country": "Austria", "lat": 48.1103, "lon": 16.5697},
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


def _merge(a: str, b: str) -> str:
    if not b:
        return a
    if not a:
        return b
    return b if len(b) > len(a) else a


# ---------------------------------------------------------------------------
# Ontology builder
# ---------------------------------------------------------------------------

class OntologyBuilder:
    def __init__(
        self,
        resolved_persons: Dataset,
        resolved_companies: Dataset,
        resolved_accounts: Dataset,
    ) -> None:
        # Start with resolved entities
        self.entities: List[Dict[str, Any]] = []
        self.entity_index: Dict[str, int] = {}  # entity_id → index in self.entities
        self.edges: List[Dict[str, Any]] = []
        self.edge_index: Dict[str, int] = {}

        # Entity lineage: entity_id → list of source refs
        self.entity_src: Dict[str, List[Dict[str, Any]]] = {}
        self.entity_field_prov: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}

        # Lookup tables
        self.person_by_passport: Dict[str, str] = {}
        self.person_by_phone: Dict[str, str] = {}
        self.person_by_alias: Dict[str, str] = {}
        self.company_by_name: Dict[str, str] = {}
        self.account_by_id: Dict[str, str] = {}
        self.device_by_id: Dict[str, str] = {}
        self.airport_by_code: Dict[str, str] = {}
        self.location_by_label: Dict[str, str] = {}

        # Ingest persons
        for row in resolved_persons.rows:
            self._add_entity_row(row, resolved_persons.name)
            eid = row["id"]
            if row.get("passportId"):
                self.person_by_passport[row["passportId"]] = eid
            if row.get("phoneNumber"):
                self.person_by_phone[row["phoneNumber"]] = eid
            # Register canonical name and aliases for lookup
            for name in [row.get("canonicalName", "")] + [
                a.strip() for a in row.get("aliases", "").split("|") if a.strip()
            ]:
                norm = _norm(name)
                if norm:
                    self.person_by_alias[norm] = eid

        # Ingest companies
        for row in resolved_companies.rows:
            self._add_entity_row(row, resolved_companies.name)
            self.company_by_name[_norm(row.get("companyName", ""))] = row["id"]

        # Ingest accounts
        for row in resolved_accounts.rows:
            self._add_entity_row(row, resolved_accounts.name)
            self.account_by_id[row["accountId"]] = row["id"]

    def _add_entity_row(self, row: Dict[str, Any], source_ds: str) -> str:
        eid = row["id"]
        if eid in self.entity_index:
            return eid
        idx = len(self.entities)
        self.entity_index[eid] = idx
        # Build Gotham-compatible entity shape
        props = {k: v for k, v in row.items() if k not in ("id", "type") and v not in (None, "")}
        entity = {
            "id": eid,
            "type": row["type"],
            "label": props.get("canonicalName") or props.get("companyName") or props.get("accountId") or eid,
            "properties": props,
            "sourceIds": [source_ds],
        }
        self.entities.append(entity)
        return eid

    def _add_edge(
        self,
        rel_type: str,
        source_id: str,
        target_id: str,
        properties: Optional[Dict[str, Any]] = None,
        dedupe_key: Optional[str] = None,
    ) -> str:
        base_key = dedupe_key or f"{rel_type}:{source_id}:{target_id}"
        edge_id = f"{rel_type.lower()}::{slug(base_key)}"
        if edge_id in self.edge_index:
            idx = self.edge_index[edge_id]
            if properties:
                for k, v in properties.items():
                    if v not in (None, ""):
                        self.edges[idx]["properties"][k] = v
            return edge_id
        idx = len(self.edges)
        self.edge_index[edge_id] = idx
        self.edges.append({
            "id": edge_id,
            "type": rel_type,
            "source": source_id,
            "target": target_id,
            "label": rel_type,
            "properties": {k: v for k, v in (properties or {}).items() if v not in (None, "")},
        })
        return edge_id

    def _ensure_entity(
        self, type_id: str, external_key: str, label: str,
        properties: Dict[str, Any], source_ds: str,
    ) -> str:
        eid = f"{type_id.lower()}::{slug(external_key)}"
        if eid in self.entity_index:
            # Merge
            existing = self.entities[self.entity_index[eid]]
            for k, v in properties.items():
                if v not in (None, "") and existing["properties"].get(k) in (None, ""):
                    existing["properties"][k] = v
            return eid
        idx = len(self.entities)
        self.entity_index[eid] = idx
        clean_props = {k: v for k, v in properties.items() if v not in (None, "")}
        self.entities.append({
            "id": eid,
            "type": type_id,
            "label": label or external_key,
            "properties": clean_props,
            "sourceIds": [source_ds],
        })
        return eid

    def ensure_airport(self, code: str) -> str:
        if code in self.airport_by_code:
            return self.airport_by_code[code]
        info = AIRPORT_COORDS.get(code, {"name": code, "city": "", "country": "", "lat": None, "lon": None})
        eid = self._ensure_entity(
            "Airport", code, info["name"],
            {"code": code, "airportName": info["name"], "city": info["city"],
             "country": info["country"], "lat": info["lat"], "lon": info["lon"]},
            "norm_flight_manifests",
        )
        self.airport_by_code[code] = eid
        return eid

    def ensure_location(
        self, label: str, lat: Any = None, lon: Any = None,
        cell_tower: str = "", location_type: str = "", city: str = "", country: str = "",
        source_ds: str = "norm_mobile_pings",
    ) -> str:
        norm = _norm(label)
        if norm in self.location_by_label:
            eid = self.location_by_label[norm]
            props = self.entities[self.entity_index[eid]]["properties"]
            for k, v in {"lat": lat, "lon": lon, "cellTower": cell_tower,
                         "locationType": location_type, "city": city, "country": country}.items():
                if v not in (None, "") and props.get(k) in (None, ""):
                    props[k] = v
            return eid
        eid = self._ensure_entity(
            "Location", label, label,
            {"label": label, "locationType": location_type, "city": city, "country": country,
             "lat": lat, "lon": lon, "cellTower": cell_tower},
            source_ds,
        )
        self.location_by_label[norm] = eid
        return eid

    def ensure_device(self, device_id: str, phone: str, observed_name: str) -> str:
        if device_id in self.device_by_id:
            eid = self.device_by_id[device_id]
            props = self.entities[self.entity_index[eid]]["properties"]
            if phone:
                props["phoneNumber"] = _merge(str(props.get("phoneNumber", "")), phone)
            if observed_name:
                props["lastObservedName"] = _merge(str(props.get("lastObservedName", "")), observed_name)
            return eid
        eid = self._ensure_entity(
            "Device", device_id, device_id,
            {"deviceId": device_id, "phoneNumber": phone, "lastObservedName": observed_name},
            "norm_mobile_pings",
        )
        self.device_by_id[device_id] = eid
        return eid

    def find_person(self, passport_id: str = "", phone: str = "", name: str = "") -> Optional[str]:
        if passport_id and passport_id in self.person_by_passport:
            return self.person_by_passport[passport_id]
        if phone and phone in self.person_by_phone:
            return self.person_by_phone[phone]
        norm = _norm(name)
        if norm and norm in self.person_by_alias:
            return self.person_by_alias[norm]
        return None

    def link_account_owner(self, account_eid: str, owner_name: str) -> None:
        norm = _norm(owner_name)
        acct_props = self.entities[self.entity_index[account_eid]]["properties"]
        if norm in self.company_by_name:
            company_id = self.company_by_name[norm]
            self._add_edge("HAS_CORP_ACCOUNT", company_id, account_eid, dedupe_key=f"{company_id}:{account_eid}")
            acct_props["accountKind"] = "corporate"
            return
        if norm in self.person_by_alias:
            person_id = self.person_by_alias[norm]
            self._add_edge("OWNS_ACCOUNT", person_id, account_eid, dedupe_key=f"{person_id}:{account_eid}")
            acct_props["accountKind"] = "personal"


# ---------------------------------------------------------------------------
# Main run
# ---------------------------------------------------------------------------

def run(
    resolved_persons: Dataset,
    resolved_companies: Dataset,
    resolved_accounts: Dataset,
    norm_watchlist: Dataset,
    norm_company_registry: Dataset,
    norm_flight_manifests: Dataset,
    norm_bank_transactions: Dataset,
    norm_mobile_pings: Dataset,
) -> Tuple[Dataset, Dataset, LineageRecord, LineageRecord]:

    builder = OntologyBuilder(resolved_persons, resolved_companies, resolved_accounts)

    # --- WatchlistRecord entities + LISTED_ON edges ---
    for row in norm_watchlist.rows:
        person_id = builder.find_person(
            passport_id=row.get("passport_id", ""),
            name=row.get("canonical_name", ""),
        )
        record_eid = builder._ensure_entity(
            "WatchlistRecord",
            row.get("watchlist_id", ""),
            row.get("watchlist_id", ""),
            {
                "watchlistId": row.get("watchlist_id", ""),
                "alias": " | ".join(row.get("aliases", [])),
                "dob": row.get("dob", ""),
                "nationality": row.get("nationality", ""),
                "passportId": row.get("passport_id", ""),
                "riskTag": row.get("risk_tag", ""),
            },
            norm_watchlist.name,
        )
        if person_id:
            builder._add_edge("LISTED_ON", person_id, record_eid,
                               dedupe_key=f"{person_id}:{record_eid}")

    # --- Company edges: DIRECTS, BENEFICIALLY_OWNS, REGISTERED_AT ---
    for row in norm_company_registry.rows:
        company_eid = f"company::{slug(row.get('company_id', ''))}"
        if company_eid not in builder.entity_index:
            continue

        # Director
        director_id = builder.find_person(name=row.get("director_name", ""),
                                           passport_id="")
        if director_id:
            builder._add_edge("DIRECTS", director_id, company_eid,
                               dedupe_key=f"{director_id}:{company_eid}")

        # Beneficial owner
        owner_id = builder.find_person(name=row.get("beneficial_owner", ""))
        if owner_id:
            builder._add_edge("BENEFICIALLY_OWNS", owner_id, company_eid,
                               dedupe_key=f"{owner_id}:{company_eid}")

        # Registered address → Location
        address = row.get("registered_address", "")
        if address:
            loc_eid = builder.ensure_location(
                address, location_type=row.get("registered_site_type", ""),
                city=row.get("registered_city", ""),
                country=row.get("registered_country", ""),
                source_ds=norm_company_registry.name,
            )
            builder._add_edge("REGISTERED_AT", company_eid, loc_eid,
                               dedupe_key=f"{company_eid}:{loc_eid}")

    # --- Flight entities + BOOKED_ON, DEPARTED_FROM, ARRIVED_AT ---
    for row in norm_flight_manifests.rows:
        person_id = builder.find_person(
            passport_id=row.get("passport_id", ""),
            phone=row.get("phone_number", ""),
            name=row.get("passenger_name", ""),
        )
        flight_eid = builder._ensure_entity(
            "Flight",
            row.get("manifest_id", ""),
            f"{row.get('flight_number', '')} · {row.get('passenger_name', '')}",
            {
                "manifestId": row.get("manifest_id", ""),
                "flightNumber": row.get("flight_number", ""),
                "departureTs": row.get("departure_ts", ""),
                "bookingReference": row.get("booking_reference", ""),
                "seat": row.get("seat", ""),
                "paymentCardLast4": row.get("payment_card_last4", ""),
            },
            norm_flight_manifests.name,
        )
        dep_eid = builder.ensure_airport(row.get("departure_airport", ""))
        arr_eid = builder.ensure_airport(row.get("arrival_airport", ""))
        if person_id:
            builder._add_edge("BOOKED_ON", person_id, flight_eid,
                               dedupe_key=f"{person_id}:{flight_eid}")
        builder._add_edge("DEPARTED_FROM", flight_eid, dep_eid,
                           dedupe_key=f"{flight_eid}:{dep_eid}")
        builder._add_edge("ARRIVED_AT", flight_eid, arr_eid,
                           dedupe_key=f"{flight_eid}:{arr_eid}")

    # --- Bank account ownership + TRANSFERRED_TO ---
    for row in norm_bank_transactions.rows:
        src_acc = row.get("source_account_id", "")
        dst_acc = row.get("destination_account_id", "")
        src_eid = builder.account_by_id.get(src_acc, "")
        dst_eid = builder.account_by_id.get(dst_acc, "")

        if src_eid:
            builder.link_account_owner(src_eid, row.get("source_name", ""))
        if dst_eid:
            builder.link_account_owner(dst_eid, row.get("destination_name", ""))

        if src_eid and dst_eid and row.get("txn_type") == "transfer":
            dedupe = f"{src_eid}:{dst_eid}"
            edge_id = f"transferred_to::{slug(dedupe)}"
            if edge_id in builder.edge_index:
                idx = builder.edge_index[edge_id]
                existing = builder.edges[idx]
                count = int(existing["properties"].get("count", "1")) + 1
                total = float(existing["properties"].get("totalAmountUsd", "0")) + float(row.get("amount_usd") or 0)
                existing["properties"]["count"] = str(count)
                existing["properties"]["totalAmountUsd"] = f"{total:.2f}"
                existing["properties"]["lastTxnTs"] = row.get("txn_ts", "")
            else:
                builder._add_edge(
                    "TRANSFERRED_TO", src_eid, dst_eid,
                    properties={
                        "count": "1",
                        "totalAmountUsd": str(row.get("amount_usd", "") or ""),
                        "lastTxnTs": row.get("txn_ts", ""),
                        "sampleReference": row.get("reference", ""),
                    },
                    dedupe_key=dedupe,
                )

    # --- Device entities + USES_DEVICE + OBSERVED_AT ---
    for row in norm_mobile_pings.rows:
        device_id_str = row.get("device_id", "")
        phone = row.get("phone_number", "")
        observed = row.get("observed_name", "")

        device_eid = builder.ensure_device(device_id_str, phone, observed)

        person_id = builder.find_person(phone=phone, name=observed)
        if not person_id and observed:
            # Create a stub person for unrecognized names observed via pings
            person_id = builder.find_person(name=observed)
        if person_id:
            builder._add_edge("USES_DEVICE", person_id, device_eid,
                               dedupe_key=f"{person_id}:{device_eid}")

        loc_eid = builder.ensure_location(
            row.get("location_label", ""),
            lat=row.get("lat"),
            lon=row.get("lon"),
            cell_tower=row.get("cell_tower", ""),
            location_type=row.get("location_type", ""),
            city=row.get("city", ""),
            country=row.get("country", ""),
        )

        dedupe = f"{device_eid}:{loc_eid}"
        edge_id = f"observed_at::{slug(dedupe)}"
        if edge_id in builder.edge_index:
            idx = builder.edge_index[edge_id]
            existing = builder.edges[idx]
            count = int(existing["properties"].get("sightingCount", "1")) + 1
            existing["properties"]["sightingCount"] = str(count)
            existing["properties"]["lastSeen"] = row.get("timestamp", "")
        else:
            builder._add_edge(
                "OBSERVED_AT", device_eid, loc_eid,
                properties={
                    "sightingCount": "1",
                    "firstSeen": row.get("timestamp", ""),
                    "lastSeen": row.get("timestamp", ""),
                    "source": row.get("source", ""),
                },
                dedupe_key=dedupe,
            )

    # --- Assemble output datasets ---
    entities_schema = [
        {"field": "id", "type": "string"},
        {"field": "type", "type": "string"},
        {"field": "label", "type": "string"},
        {"field": "properties", "type": "json"},
        {"field": "sourceIds", "type": "json"},
    ]
    edges_schema = [
        {"field": "id", "type": "string"},
        {"field": "type", "type": "string"},
        {"field": "source", "type": "string"},
        {"field": "target", "type": "string"},
        {"field": "label", "type": "string"},
        {"field": "properties", "type": "json"},
    ]

    entities_ds = Dataset(
        name="ontology_entities",
        rows=sorted(builder.entities, key=lambda e: (str(e["type"]), str(e["label"]))),
        schema=entities_schema,
    )
    edges_ds = Dataset(
        name="ontology_edges",
        rows=sorted(builder.edges, key=lambda e: (str(e["type"]), str(e["source"]), str(e["target"]))),
        schema=edges_schema,
    )

    # Trivial lineage: each entity/edge row came from its sourceIds
    entity_lineage = LineageRecord()
    for out_idx, entity in enumerate(entities_ds.rows):
        for src in entity.get("sourceIds", []):
            entity_lineage.add_source(out_idx, src, 0, note=entity["type"])

    edge_lineage = LineageRecord()
    for out_idx, edge in enumerate(edges_ds.rows):
        edge_lineage.add_source(out_idx, edge["type"], 0, note="edge")

    return entities_ds, edges_ds, entity_lineage, edge_lineage


if __name__ == "__main__":
    from pipeline import p01_normalize_sources as n01
    from pipeline import p02_resolve_persons as n02
    from pipeline import p03_resolve_companies as n03
    from pipeline import p04_resolve_accounts as n04

    dataset_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic_data/starter")
    wl, cr, fm, bt, mp = n01.run(dataset_dir)
    persons, _ = n02.run(wl, cr, fm, bt, mp)
    companies, _ = n03.run(cr)
    accounts, _ = n04.run(bt)
    entities_ds, edges_ds, _, _ = run(persons, companies, accounts, wl, cr, fm, bt, mp)
    print(f"Entities: {len(entities_ds)}, Edges: {len(edges_ds)}")
