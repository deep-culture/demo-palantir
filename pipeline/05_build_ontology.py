"""
pipeline/05_build_ontology.py — Build the full ontology entity and edge sets.

Takes all resolved entity datasets + normalized sources.  Produces:
  - Additional entity types: Device, Flight, Airport, Location, WatchlistRecord
  - All edges:
      LISTED_ON, DIRECTS, BENEFICIALLY_OWNS, REGISTERED_AT,
      OWNS_ACCOUNT, HAS_CORP_ACCOUNT, TRANSFERRED_TO,
      BOOKED_ON, DEPARTED_FROM, ARRIVED_AT,
      USES_DEVICE, OBSERVED_AT,
      RESIDES_AT (Phase 1: Person → residential Location, from clinic rows)

Clinic rows that the shared resolver attached to a Person (name + dob) become
a residential ``Location`` (``locationType: "residential"``) and a
``RESIDES_AT`` link with ``{asOf, source}``.  Unattached rows produce nothing.

Both output datasets inherit the union of their inputs' markings, and every
entity and edge gets contract §3 markings from ``pipeline/governance.py``.

Person lookups go through the shared resolver in ``pipeline/resolution.py``
(the same one the Gotham seed builder uses), passing every key the source row
carries — passport, phone, name and date of birth — so both demos attach
each edge to the same person.

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

from pipeline import governance
from pipeline.lib import Dataset, LineageRecord, inherit_markings, slug
from pipeline.resolution import PersonResolver, attach_clinic_rows, clinic_observations, resolve_people

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
        resolver: PersonResolver,
    ) -> None:
        # Start with resolved entities
        self.entities: List[Dict[str, Any]] = []
        self.entity_index: Dict[str, int] = {}  # entity_id → index in self.entities
        self.edges: List[Dict[str, Any]] = []
        self.edge_index: Dict[str, int] = {}

        # Entity lineage: entity_id → list of source refs
        self.entity_src: Dict[str, List[Dict[str, Any]]] = {}
        self.entity_field_prov: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}

        # Lookup tables (persons: the shared resolver from step 02)
        self.resolver = resolver
        self.company_by_name: Dict[str, str] = {}
        self.account_by_id: Dict[str, str] = {}
        self.device_by_id: Dict[str, str] = {}
        self.airport_by_code: Dict[str, str] = {}
        self.location_by_label: Dict[str, str] = {}

        # Ingest persons
        for row in resolved_persons.rows:
            self._add_entity_row(row, resolved_persons.name)

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
        props = {k: v for k, v in row.items() if k not in ("id", "type", "resolution") and v not in (None, "")}
        entity = {
            "id": eid,
            "type": row["type"],
            "label": props.get("canonicalName") or props.get("companyName") or props.get("accountId") or eid,
            "properties": props,
            "sourceIds": [source_ds],
        }
        if row.get("resolution"):
            entity["resolution"] = row["resolution"]
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

    def find_person(self, passport_id: str = "", phone: str = "", name: str = "", dob: str = "",
                    ref: str = "") -> Optional[str]:
        """Person for a source record (``ref``) or, failing that, by key lookup."""
        if ref:
            return self.resolver.person_for(ref, name=name, dob=dob, passport=passport_id, phone=phone)
        return self.resolver.find(name=name, dob=dob, passport=passport_id, phone=phone)

    def link_account_owner(self, account_eid: str, owner_name: str) -> None:
        norm = _norm(owner_name)
        acct_props = self.entities[self.entity_index[account_eid]]["properties"]
        if norm in self.company_by_name:
            company_id = self.company_by_name[norm]
            self._add_edge("HAS_CORP_ACCOUNT", company_id, account_eid, dedupe_key=f"{company_id}:{account_eid}")
            acct_props["accountKind"] = "corporate"
            return
        person_id = self.find_person(name=owner_name)
        if person_id:
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
    norm_clinic_registrations: Dataset,
) -> Tuple[Dataset, Dataset, LineageRecord, LineageRecord]:

    resolver = getattr(resolved_persons, "resolver", None)
    if resolver is None:
        # Rebuild the identical resolver state from the normalised sources.
        resolver = resolve_people(norm_watchlist.rows, norm_company_registry.rows,
                                  norm_flight_manifests.rows, norm_mobile_pings.rows)
        attach_clinic_rows(resolver, norm_clinic_registrations.rows)
    builder = OntologyBuilder(resolved_persons, resolved_companies, resolved_accounts, resolver)

    # --- WatchlistRecord entities + LISTED_ON edges ---
    for row in norm_watchlist.rows:
        person_id = builder.find_person(
            passport_id=row.get("passport_id", ""),
            name=row.get("canonical_name", ""),
            dob=row.get("dob", ""),
            ref=f"watchlist:{row.get('watchlist_id', '')}",
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
                                           dob=row.get("director_dob", ""),
                                           ref=f"company:{row.get('company_id', '')}:director")
        if director_id:
            builder._add_edge("DIRECTS", director_id, company_eid,
                               dedupe_key=f"{director_id}:{company_eid}")

        # Beneficial owner
        owner_id = builder.find_person(name=row.get("beneficial_owner", ""),
                                        dob=row.get("beneficial_owner_dob", ""),
                                        ref=f"company:{row.get('company_id', '')}:owner")
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
            dob=row.get("dob", ""),
            ref=f"flight:{row.get('manifest_id', '')}",
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
                        "totalAmountUsd": f"{float(row['amount_usd']):.2f}" if row.get("amount_usd") not in (None, "") else "",
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

        # Ping-only persons were already created by step 02's resolver.
        person_id = builder.find_person(phone=phone, name=observed,
                                        ref=f"ping:{row.get('ping_id', '')}")
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

    # --- Residential Locations + RESIDES_AT (clinic rows, Phase 1) ---
    for obs in clinic_observations(norm_clinic_registrations.rows):
        person_id = resolver.clinic_by_ref.get(obs.ref)
        if not person_id:
            continue  # unattached clinic rows create no objects
        row = obs.row
        loc_eid = builder.ensure_location(
            row.get("home_address", ""),
            lat=row.get("lat"),
            lon=row.get("lon"),
            location_type="residential",
            city=row.get("home_city", ""),
            country=row.get("home_country", ""),
            source_ds=norm_clinic_registrations.name,
        )
        dedupe = f"{person_id}:{loc_eid}"
        edge_id = f"resides_at::{slug(dedupe)}"
        as_of = row.get("registered_on", "")
        if edge_id in builder.edge_index:
            existing = builder.edges[builder.edge_index[edge_id]]
            if as_of > str(existing["properties"].get("asOf", "")):
                existing["properties"]["asOf"] = as_of
        else:
            builder._add_edge("RESIDES_AT", person_id, loc_eid,
                               properties={"asOf": as_of, "source": row.get("source", "")},
                               dedupe_key=dedupe)

    # --- Markings on every object and link (contract §3) ---
    raw_inputs = [norm_watchlist, norm_company_registry, norm_flight_manifests,
                  norm_bank_transactions, norm_mobile_pings, norm_clinic_registrations]
    file_markings = {ds.derived_from[0]: ds.markings for ds in raw_inputs if ds.derived_from}
    governance.annotate_objects(builder.entities, builder.edges, file_markings)

    # --- Assemble output datasets ---
    entities_schema = [
        {"field": "id", "type": "string"},
        {"field": "type", "type": "string"},
        {"field": "label", "type": "string"},
        {"field": "properties", "type": "json"},
        {"field": "sourceIds", "type": "json"},
        {"field": "markings", "type": "json"},
        {"field": "propertyMarkings", "type": "json"},
        {"field": "sourceMarkings", "type": "json"},
    ]
    edges_schema = [
        {"field": "id", "type": "string"},
        {"field": "type", "type": "string"},
        {"field": "source", "type": "string"},
        {"field": "target", "type": "string"},
        {"field": "label", "type": "string"},
        {"field": "properties", "type": "json"},
        {"field": "markings", "type": "json"},
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

    ontology_inputs = [resolved_persons, resolved_companies, resolved_accounts] + raw_inputs
    inherit_markings(entities_ds, ontology_inputs)
    inherit_markings(edges_ds, ontology_inputs)

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
    wl, cr, fm, bt, mp, cl = n01.run(dataset_dir)
    persons, _ = n02.run(wl, cr, fm, mp, cl)
    companies, _ = n03.run(cr)
    accounts, _ = n04.run(bt)
    entities_ds, edges_ds, _, _ = run(persons, companies, accounts, wl, cr, fm, bt, mp, cl)
    print(f"Entities: {len(entities_ds)}, Edges: {len(edges_ds)}")
