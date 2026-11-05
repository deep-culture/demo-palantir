#!/usr/bin/env python3
"""
scripts/build_ontology_seed.py — build demo/seed.js (the Gotham-style demo).

Persons are resolved by the shared resolver in pipeline/resolution.py (the
same one the Foundry pipeline uses), in two passes: first every
person-bearing record is resolved, then edges are linked with
``PersonResolver.find`` using the keys each source row carries.  Both seeds
therefore have identical entity IDs and identical (type, source, target)
edge sets.

Phase 1: clinic registrations are attached to existing people by name + dob
(``resolution.attach_clinic_rows``; never a new Person), giving the Person
``homeAddress`` / ``clinicCode`` and a residential ``Location`` with a
``RESIDES_AT`` link.  Markings, roles, checkpoints and honesty labels come from
``pipeline/governance.py`` and dataset markings from ``manifest.json``, the
same as the Foundry seed.

Phase 2: ``ontology.actionTypes`` / ``ontology.externalSystems`` come from
``pipeline/actions.py`` and the ``resolution`` block (cross-person candidate
pairs with transparent scores) from ``pipeline/candidates.py``; the Foundry
seed carries identical copies.

Phase 3: ``leads`` (``{asOf, formula, weights, items}``) comes from
``pipeline/leads.py``, the scorer the Foundry transform
``pipeline/06_build_leads.py`` wraps, so both seeds hold the same leads.
Leads are not ontology objects; the Close lead Action edits ``leads.items``.
"""

import argparse
import csv
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from pipeline import actions, candidates, governance, leads  # noqa: E402
from pipeline.resolution import (  # noqa: E402
    Observation, PersonResolver, attach_clinic_rows, latest_clinic_rows, person_observations,
)
from pipeline.seedmeta import build_metadata  # noqa: E402


ENTITY_TYPES = [
    {
        "id": "Person",
        "name": "Person",
        "description": "Individuals resolved across manifests, watchlists, company records, banking, and device activity.",
        "color": "#3b82f6",
        "properties": [
            {"id": "canonicalName", "label": "Canonical name", "type": "string", "required": True, "description": "Resolved display name."},
            {"id": "aliases", "label": "Aliases", "type": "string", "required": False, "description": "Known alternate spellings or abbreviations."},
            {"id": "dob", "label": "Date of birth", "type": "date", "required": False, "description": "Birth date used for matching."},
            {"id": "nationality", "label": "Nationality", "type": "string", "required": False, "description": "Primary nationality from source data."},
            {"id": "passportId", "label": "Passport ID", "type": "string", "required": False, "description": "Strong cross-source identifier."},
            {"id": "phoneNumber", "label": "Phone number", "type": "string", "required": False, "description": "Common device and travel join key."},
            {"id": "riskTag", "label": "Risk tag", "type": "string", "required": False, "description": "Scenario-specific risk descriptor."},
            {"id": "homeAddress", "label": "Home address", "type": "string", "required": False, "description": "Latest home address from a clinic registration (health data)."},
            {"id": "clinicCode", "label": "Clinic code", "type": "string", "required": False, "description": "Clinic of the latest registration (health data)."},
        ],
    },
    {
        "id": "Company",
        "name": "Company",
        "description": "Registered entities that share directors, beneficial owners, addresses, and bank accounts.",
        "color": "#8b5cf6",
        "properties": [
            {"id": "companyName", "label": "Company name", "type": "string", "required": True, "description": "Registered company name."},
            {"id": "jurisdiction", "label": "Jurisdiction", "type": "string", "required": False, "description": "Registration country or region."},
            {"id": "incorporationDate", "label": "Incorporation date", "type": "date", "required": False, "description": "Registration date."},
            {"id": "registeredAddress", "label": "Registered address", "type": "string", "required": False, "description": "Declared address from the registry."},
        ],
    },
    {
        "id": "BankAccount",
        "name": "Bank Account",
        "description": "Accounts inferred from transaction feeds and linked to people or companies when the owner can be resolved.",
        "color": "#10b981",
        "properties": [
            {"id": "accountId", "label": "Account ID", "type": "string", "required": True, "description": "Primary account identifier."},
            {"id": "ownerName", "label": "Owner name", "type": "string", "required": False, "description": "Raw owner name from the transaction source."},
            {"id": "accountKind", "label": "Account kind", "type": "string", "required": False, "description": "Derived owner class such as personal or corporate."},
            {"id": "reviewFlag", "label": "Review flag", "type": "string", "required": False, "description": "Set by the Flag account for review Action (routine or urgent)."},
        ],
    },
    {
        "id": "Device",
        "name": "Device",
        "description": "Handsets or device identifiers observed in the mobile location feed.",
        "color": "#14b8a6",
        "properties": [
            {"id": "deviceId", "label": "Device ID", "type": "string", "required": True, "description": "Source device identifier."},
            {"id": "phoneNumber", "label": "Phone number", "type": "string", "required": False, "description": "Phone number carried in the location feed."},
            {"id": "lastObservedName", "label": "Last observed name", "type": "string", "required": False, "description": "Latest raw name attached to the device."},
        ],
    },
    {
        "id": "Flight",
        "name": "Flight Booking",
        "description": "Passenger-level flight records from the manifest feed.",
        "color": "#f59e0b",
        "properties": [
            {"id": "manifestId", "label": "Manifest ID", "type": "string", "required": True, "description": "Unique manifest row identifier."},
            {"id": "flightNumber", "label": "Flight number", "type": "string", "required": True, "description": "Carrier and flight number."},
            {"id": "departureTs", "label": "Departure time", "type": "datetime", "required": False, "description": "Scheduled departure timestamp."},
            {"id": "bookingReference", "label": "Booking reference", "type": "string", "required": False, "description": "Reservation code."},
            {"id": "seat", "label": "Seat", "type": "string", "required": False, "description": "Assigned seat from the manifest."},
            {"id": "paymentCardLast4", "label": "Card last 4", "type": "string", "required": False, "description": "Payment-card suffix used in the booking."},
        ],
    },
    {
        "id": "Airport",
        "name": "Airport",
        "description": "Airports used as endpoints for travel events.",
        "color": "#ef4444",
        "properties": [
            {"id": "code", "label": "Code", "type": "string", "required": True, "description": "IATA-style airport code."},
            {"id": "airportName", "label": "Airport name", "type": "string", "required": False, "description": "Display label used in the graph."},
            {"id": "city", "label": "City", "type": "string", "required": False, "description": "Airport city for map and popup views."},
            {"id": "country", "label": "Country", "type": "string", "required": False, "description": "Airport country for map and popup views."},
            {"id": "lat", "label": "Latitude", "type": "number", "required": False, "description": "Approximate latitude for map views."},
            {"id": "lon", "label": "Longitude", "type": "number", "required": False, "description": "Approximate longitude for map views."},
        ],
    },
    {
        "id": "Location",
        "name": "Location",
        "description": "Named places such as registered addresses, towers, marinas, airport-adjacent observations, and residential addresses from clinic registrations.",
        "color": "#ec4899",
        "properties": [
            {"id": "label", "label": "Label", "type": "string", "required": True, "description": "Human-readable place label."},
            {"id": "locationType", "label": "Location type", "type": "string", "required": False, "description": "Site category such as office, marina, warehouse, airport, or residential."},
            {"id": "city", "label": "City", "type": "string", "required": False, "description": "City associated with the place."},
            {"id": "country", "label": "Country", "type": "string", "required": False, "description": "Country associated with the place."},
            {"id": "lat", "label": "Latitude", "type": "number", "required": False, "description": "Approximate latitude."},
            {"id": "lon", "label": "Longitude", "type": "number", "required": False, "description": "Approximate longitude."},
            {"id": "cellTower", "label": "Cell tower", "type": "string", "required": False, "description": "Tower or location code if available."},
        ],
    },
    {
        "id": "WatchlistRecord",
        "name": "Watchlist Record",
        "description": "Watchlist entries that preserve source-specific risk annotations.",
        "color": "#64748b",
        "properties": [
            {"id": "watchlistId", "label": "Watchlist ID", "type": "string", "required": True, "description": "Source watchlist identifier."},
            {"id": "alias", "label": "Aliases", "type": "string", "required": False, "description": "Delimited alias list from the watchlist."},
            {"id": "dob", "label": "Date of birth", "type": "date", "required": False, "description": "Watchlist birth date."},
            {"id": "nationality", "label": "Nationality", "type": "string", "required": False, "description": "Nationality from the watchlist."},
            {"id": "passportId", "label": "Passport ID", "type": "string", "required": False, "description": "Passport ID from the watchlist."},
            {"id": "riskTag", "label": "Risk tag", "type": "string", "required": False, "description": "Reason the record is interesting."},
            {"id": "reason", "label": "Reason", "type": "string", "required": False, "description": "Stated reason, for records created by the Add to watchlist Action."},
            {"id": "addedBy", "label": "Added by", "type": "string", "required": False, "description": "Role that ran the Add to watchlist Action."},
            {"id": "addedAt", "label": "Added at", "type": "datetime", "required": False, "description": "When the Action created the record."},
            {"id": "origin", "label": "Origin", "type": "string", "required": False, "description": "\"action\" for records created by an Action; empty for the watchlist feed."},
        ],
    },
]

AIRPORT_COORDS = {
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

RELATIONSHIP_TYPES = [
    {"id": "LISTED_ON", "label": "LISTED_ON", "sourceType": "Person", "targetType": "WatchlistRecord", "description": "Connects a resolved person to a watchlist row.", "color": "#64748b"},
    {"id": "DIRECTS", "label": "DIRECTS", "sourceType": "Person", "targetType": "Company", "description": "Director listed on a company record.", "color": "#7c3aed"},
    {"id": "BENEFICIALLY_OWNS", "label": "BENEFICIALLY_OWNS", "sourceType": "Person", "targetType": "Company", "description": "Beneficial owner inferred from the registry.", "color": "#9333ea"},
    {"id": "REGISTERED_AT", "label": "REGISTERED_AT", "sourceType": "Company", "targetType": "Location", "description": "Company registered or declared at a location.", "color": "#db2777"},
    {"id": "OWNS_ACCOUNT", "label": "OWNS_ACCOUNT", "sourceType": "Person", "targetType": "BankAccount", "description": "Resolved personal account ownership.", "color": "#059669"},
    {"id": "HAS_CORP_ACCOUNT", "label": "HAS_CORP_ACCOUNT", "sourceType": "Company", "targetType": "BankAccount", "description": "Resolved corporate account ownership.", "color": "#047857"},
    {"id": "TRANSFERRED_TO", "label": "TRANSFERRED_TO", "sourceType": "BankAccount", "targetType": "BankAccount", "description": "Aggregated transfer flow between accounts.", "color": "#16a34a"},
    {"id": "BOOKED_ON", "label": "BOOKED_ON", "sourceType": "Person", "targetType": "Flight", "description": "Passenger booked on a manifest row.", "color": "#d97706"},
    {"id": "DEPARTED_FROM", "label": "DEPARTED_FROM", "sourceType": "Flight", "targetType": "Airport", "description": "Flight departure airport.", "color": "#dc2626"},
    {"id": "ARRIVED_AT", "label": "ARRIVED_AT", "sourceType": "Flight", "targetType": "Airport", "description": "Flight arrival airport.", "color": "#b91c1c"},
    {"id": "USES_DEVICE", "label": "USES_DEVICE", "sourceType": "Person", "targetType": "Device", "description": "Person associated with a device identifier.", "color": "#0f766e"},
    {"id": "OBSERVED_AT", "label": "OBSERVED_AT", "sourceType": "Device", "targetType": "Location", "description": "Aggregated device sightings at a place.", "color": "#be185d"},
    {"id": "RESIDES_AT", "label": "RESIDES_AT", "sourceType": "Person", "targetType": "Location", "description": "Home address from a clinic registration, with asOf and source.", "color": "#a21caf"},
]


def normalize_name(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
    return re.sub(r"\s+", " ", cleaned)


def slug(value: str) -> str:
    token = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return token or "unknown"


def read_csv(path: Path) -> List[Dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def read_jsonl(path: Path) -> List[Dict[str, str]]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def merge_value(current: str, incoming: str) -> str:
    if not incoming:
        return current
    if not current:
        return incoming
    if current == incoming:
        return current
    return incoming if len(incoming) > len(current) else current


class SeedBuilder:
    def __init__(self) -> None:
        self.entities: List[Dict[str, object]] = []
        self.entity_index: Dict[str, Dict[str, object]] = {}
        self.edges: List[Dict[str, object]] = []
        self.edge_index: Dict[str, Dict[str, object]] = {}
        self.resolver = PersonResolver()
        self.person_alias_sets: Dict[str, set] = defaultdict(set)
        self.company_by_name: Dict[str, str] = {}
        self.account_by_id: Dict[str, str] = {}
        self.device_by_id: Dict[str, str] = {}
        self.airport_by_code: Dict[str, str] = {}
        self.location_by_label: Dict[str, str] = {}

    def upsert_entity(
        self,
        type_id: str,
        external_key: str,
        label: str,
        properties: Dict[str, object],
        source_ids: Optional[Iterable[str]] = None,
    ) -> str:
        entity_id = f"{type_id.lower()}::{slug(external_key)}"
        entity = self.entity_index.get(entity_id)
        cleaned_properties = {key: value for key, value in properties.items() if value not in ("", None)}
        if entity is None:
            entity = {
                "id": entity_id,
                "type": type_id,
                "label": label or external_key,
                "properties": cleaned_properties,
                "sourceIds": sorted(set(source_ids or [])),
            }
            self.entities.append(entity)
            self.entity_index[entity_id] = entity
            return entity_id

        if label:
            entity["label"] = merge_value(str(entity["label"]), label)
        entity_properties = entity["properties"]
        for key, value in cleaned_properties.items():
            existing = entity_properties.get(key, "")
            if isinstance(value, str):
                entity_properties[key] = merge_value(str(existing), value)
            else:
                entity_properties[key] = value if existing in ("", None) else existing
        if source_ids:
            entity["sourceIds"] = sorted(set(entity["sourceIds"]) | set(source_ids))
        return entity_id

    def add_edge(
        self,
        relationship_id: str,
        source_id: str,
        target_id: str,
        properties: Optional[Dict[str, object]] = None,
        label: str = "",
        dedupe_key: Optional[str] = None,
    ) -> str:
        base_key = dedupe_key or f"{relationship_id}:{source_id}:{target_id}"
        edge_id = f"{relationship_id.lower()}::{slug(base_key)}"
        edge = self.edge_index.get(edge_id)
        if edge is None:
            edge = {
                "id": edge_id,
                "type": relationship_id,
                "source": source_id,
                "target": target_id,
                "label": label or relationship_id,
                "properties": {key: value for key, value in (properties or {}).items() if value not in ("", None)},
            }
            self.edges.append(edge)
            self.edge_index[edge_id] = edge
            return edge_id

        for key, value in (properties or {}).items():
            if value not in ("", None):
                edge["properties"][key] = value
        return edge_id

    def absorb_person(self, obs: Observation) -> Optional[str]:
        """Resolve one person-bearing record and merge its properties."""
        record = self.resolver.observe(obs)
        if record is None:
            return None
        person_id = record.id
        if person_id not in self.entity_index:
            self.upsert_entity(
                "Person",
                person_id.split("::", 1)[1],
                obs.name or person_id,
                {"canonicalName": obs.name},
                source_ids=["starter-seed"],
            )
        person_props = self.entity_index[person_id]["properties"]
        is_ping = obs.kind == "ping"
        if obs.dob:
            person_props["dob"] = merge_value(str(person_props.get("dob", "")), obs.dob)
        nationality = str(obs.row.get("nationality", "") or "") if obs.kind == "watchlist" else ""
        if nationality:
            person_props["nationality"] = merge_value(str(person_props.get("nationality", "")), nationality)
        if obs.passport:
            person_props["passportId"] = obs.passport
        if obs.phone and (not is_ping or not person_props.get("phoneNumber")):
            person_props["phoneNumber"] = obs.phone
        risk_tag = str(obs.row.get("risk_tag", "") or "") if obs.kind == "watchlist" else ""
        if risk_tag:
            person_props["riskTag"] = merge_value(str(person_props.get("riskTag", "")), risk_tag)
        for alias in (obs.name, *obs.aliases):
            if alias:
                self.person_alias_sets[person_id].add(alias)
        return person_id

    def find_person(self, name: str = "", dob: str = "", passport_id: str = "", phone_number: str = "",
                    ref: str = "") -> Optional[str]:
        """Person for a source record (``ref``) or, failing that, by key lookup."""
        if ref:
            return self.resolver.person_for(ref, name=name, dob=dob, passport=passport_id, phone=phone_number)
        return self.resolver.find(name=name, dob=dob, passport=passport_id, phone=phone_number)

    def finalize_people(self) -> None:
        resolutions = self.resolver.resolutions()
        for person_id, record in self.resolver.records.items():
            person = self.entity_index[person_id]
            canonical_name = record.display_name or person_id
            person["properties"]["canonicalName"] = canonical_name
            person["label"] = canonical_name
            aliases = self.person_alias_sets.get(person_id, set())
            cleaned = sorted(alias for alias in aliases if alias and alias != canonical_name)
            if cleaned:
                person["properties"]["aliases"] = " | ".join(cleaned)
            else:
                person["properties"].pop("aliases", None)
            person["resolution"] = resolutions[person_id]

    def ensure_company(self, company_id: str, company_name: str, jurisdiction: str, incorporation_date: str, registered_address: str) -> str:
        entity_id = self.upsert_entity(
            "Company",
            company_id or company_name,
            company_name,
            {
                "companyName": company_name,
                "jurisdiction": jurisdiction,
                "incorporationDate": incorporation_date,
                "registeredAddress": registered_address,
            },
            source_ids=["company_registry.csv"],
        )
        self.company_by_name[normalize_name(company_name)] = entity_id
        return entity_id

    def ensure_bank_account(self, account_id: str, owner_name: str) -> str:
        entity_id = self.account_by_id.get(account_id)
        if entity_id:
            account = self.entity_index[entity_id]
            account["properties"]["ownerName"] = merge_value(str(account["properties"].get("ownerName", "")), owner_name)
            return entity_id
        entity_id = self.upsert_entity(
            "BankAccount",
            account_id,
            account_id,
            {"accountId": account_id, "ownerName": owner_name},
            source_ids=["bank_transactions.csv"],
        )
        self.account_by_id[account_id] = entity_id
        return entity_id

    def link_account_owner(self, account_entity_id: str, owner_name: str) -> None:
        normalized_name = normalize_name(owner_name)
        if normalized_name in self.company_by_name:
            company_id = self.company_by_name[normalized_name]
            self.add_edge("HAS_CORP_ACCOUNT", company_id, account_entity_id, dedupe_key=f"{company_id}:{account_entity_id}")
            self.entity_index[account_entity_id]["properties"]["accountKind"] = "corporate"
            return
        person_id = self.find_person(name=owner_name)
        if person_id:
            self.add_edge("OWNS_ACCOUNT", person_id, account_entity_id, dedupe_key=f"{person_id}:{account_entity_id}")
            self.entity_index[account_entity_id]["properties"]["accountKind"] = "personal"

    def ensure_device(self, device_id: str, phone_number: str, observed_name: str) -> str:
        entity_id = self.device_by_id.get(device_id)
        if entity_id:
            entity = self.entity_index[entity_id]
            entity["properties"]["phoneNumber"] = merge_value(str(entity["properties"].get("phoneNumber", "")), phone_number)
            entity["properties"]["lastObservedName"] = merge_value(str(entity["properties"].get("lastObservedName", "")), observed_name)
            return entity_id
        entity_id = self.upsert_entity(
            "Device",
            device_id,
            device_id,
            {"deviceId": device_id, "phoneNumber": phone_number, "lastObservedName": observed_name},
            source_ids=["mobile_location_pings.jsonl"],
        )
        self.device_by_id[device_id] = entity_id
        return entity_id

    def ensure_airport(self, code: str) -> str:
        if code in self.airport_by_code:
            return self.airport_by_code[code]
        airport = AIRPORT_COORDS.get(code, {"name": code, "city": "", "country": "", "lat": "", "lon": ""})
        entity_id = self.upsert_entity(
            "Airport",
            code,
            airport["name"],
            {
                "code": code,
                "airportName": airport["name"],
                "city": airport["city"],
                "country": airport["country"],
                "lat": airport["lat"],
                "lon": airport["lon"],
            },
            source_ids=["flight_manifests.csv"],
        )
        self.airport_by_code[code] = entity_id
        return entity_id

    def ensure_location(
        self,
        label: str,
        lat: object = "",
        lon: object = "",
        cell_tower: str = "",
        location_type: str = "",
        city: str = "",
        country: str = "",
        source_ids: Iterable[str] = ("company_registry.csv", "mobile_location_pings.jsonl"),
    ) -> str:
        normalized = normalize_name(label)
        if normalized in self.location_by_label:
            entity_id = self.location_by_label[normalized]
            location = self.entity_index[entity_id]
            for key, value in {
                "lat": lat,
                "lon": lon,
                "cellTower": cell_tower,
                "locationType": location_type,
                "city": city,
                "country": country,
            }.items():
                if value not in ("", None):
                    location["properties"][key] = value
            return entity_id
        entity_id = self.upsert_entity(
            "Location",
            label,
            label,
            {
                "label": label,
                "locationType": location_type,
                "city": city,
                "country": country,
                "lat": lat,
                "lon": lon,
                "cellTower": cell_tower,
            },
            source_ids=list(source_ids),
        )
        self.location_by_label[normalized] = entity_id
        return entity_id


def build_mappings(source_headers: Dict[str, List[str]]) -> List[Dict[str, object]]:
    return [
        {
            "id": "map-watchlist-person",
            "sourceId": "watchlist.csv",
            "sourceFields": "canonical_name, alias, dob, nationality, passport_id, risk_tag",
            "targetType": "Person",
            "targetProperty": "canonicalName, aliases, dob, nationality, passportId, riskTag",
            "relationType": "LISTED_ON",
            "rule": "Match or create Person by passport_id, then canonical_name + dob. Alias values extend the person alias set.",
        },
        {
            "id": "map-watchlist-record",
            "sourceId": "watchlist.csv",
            "sourceFields": "watchlist_id, alias, risk_tag",
            "targetType": "WatchlistRecord",
            "targetProperty": "watchlistId, alias, riskTag",
            "relationType": "LISTED_ON",
            "rule": "Each watchlist row is preserved as its own WatchlistRecord node for provenance.",
        },
        {
            "id": "map-company-registry-company",
            "sourceId": "company_registry.csv",
            "sourceFields": "company_id, company_name, jurisdiction, incorporation_date, registered_address, registered_city, registered_country, registered_site_type",
            "targetType": "Company",
            "targetProperty": "companyName, jurisdiction, incorporationDate, registeredAddress",
            "relationType": "REGISTERED_AT",
            "rule": "Company rows create Company nodes and a Location node for the declared address enriched with city, country, and site type.",
        },
        {
            "id": "map-company-director",
            "sourceId": "company_registry.csv",
            "sourceFields": "director_name, director_dob",
            "targetType": "Person",
            "targetProperty": "canonicalName, dob",
            "relationType": "DIRECTS",
            "rule": "Directors are matched or created as Person nodes using name + dob.",
        },
        {
            "id": "map-company-owner",
            "sourceId": "company_registry.csv",
            "sourceFields": "beneficial_owner, beneficial_owner_dob",
            "targetType": "Person",
            "targetProperty": "canonicalName, dob",
            "relationType": "BENEFICIALLY_OWNS",
            "rule": "Beneficial owners are matched as Person nodes and linked to companies.",
        },
        {
            "id": "map-flight-passenger",
            "sourceId": "flight_manifests.csv",
            "sourceFields": "passenger_name, dob, passport_id, phone_number",
            "targetType": "Person",
            "targetProperty": "canonicalName, dob, passportId, phoneNumber",
            "relationType": "BOOKED_ON",
            "rule": "Passenger rows enrich Person nodes and attach them to a Flight booking node.",
        },
        {
            "id": "map-flight-booking",
            "sourceId": "flight_manifests.csv",
            "sourceFields": "manifest_id, flight_number, departure_ts, booking_reference, seat, payment_card_last4",
            "targetType": "Flight",
            "targetProperty": "manifestId, flightNumber, departureTs, bookingReference, seat, paymentCardLast4",
            "relationType": "DEPARTED_FROM / ARRIVED_AT",
            "rule": "Each manifest row becomes a flight-booking node connected to departure and arrival airports.",
        },
        {
            "id": "map-transactions-account",
            "sourceId": "bank_transactions.csv",
            "sourceFields": "source_account_id, destination_account_id, source_name, destination_name",
            "targetType": "BankAccount",
            "targetProperty": "accountId, ownerName",
            "relationType": "OWNS_ACCOUNT / HAS_CORP_ACCOUNT",
            "rule": "Accounts are created from transaction rows and linked back to people or companies by owner name.",
        },
        {
            "id": "map-transactions-flow",
            "sourceId": "bank_transactions.csv",
            "sourceFields": "amount_usd, txn_ts, txn_type, reference",
            "targetType": "BankAccount",
            "targetProperty": "n/a",
            "relationType": "TRANSFERRED_TO",
            "rule": "Transfers are aggregated into account-to-account edges with count, totalAmountUsd, and lastTxnTs properties.",
        },
        {
            "id": "map-pings-device",
            "sourceId": "mobile_location_pings.jsonl",
            "sourceFields": "device_id, phone_number, observed_name",
            "targetType": "Device",
            "targetProperty": "deviceId, phoneNumber, lastObservedName",
            "relationType": "USES_DEVICE",
            "rule": "Device rows are linked to people by phone number first, then by normalized alias name.",
        },
        {
            "id": "map-pings-location",
            "sourceId": "mobile_location_pings.jsonl",
            "sourceFields": "location_label, location_type, city, country, lat, lon, cell_tower, timestamp, source",
            "targetType": "Location",
            "targetProperty": "label, locationType, city, country, lat, lon, cellTower",
            "relationType": "OBSERVED_AT",
            "rule": "Device sightings are aggregated by device/location pair with firstSeen, lastSeen, and sightingCount.",
        },
        {
            "id": "map-clinic-person",
            "sourceId": "clinic_registrations.csv",
            "sourceFields": "patient_name, dob, home_address, clinic_code, registered_on",
            "targetType": "Person",
            "targetProperty": "homeAddress, clinicCode",
            "relationType": "",
            "rule": "Attach to an existing Person by exact name + date of birth only; an unmatched row creates nothing. The latest registration supplies homeAddress and clinicCode (marked PII and HEALTH).",
        },
        {
            "id": "map-clinic-residence",
            "sourceId": "clinic_registrations.csv",
            "sourceFields": "home_address, home_city, home_country, lat, lon, registered_on, source",
            "targetType": "Location",
            "targetProperty": "label, locationType (residential), city, country, lat, lon",
            "relationType": "RESIDES_AT",
            "rule": "Each attached row yields a residential Location and a RESIDES_AT link (both marked PII and HEALTH) with asOf = registered_on and source.",
        },
        {
            "id": "map-source-header-reference",
            "sourceId": "all-sources",
            "sourceFields": " | ".join(f"{source}: {', '.join(headers)}" for source, headers in source_headers.items()),
            "targetType": "Reference",
            "targetProperty": "n/a",
            "relationType": "",
            "rule": "Reference row so students can see raw source headers beside the ontology mappings.",
        },
    ]


def build_seed(dataset_key: str, dataset_dir: Path, dataset_path_label: str) -> Dict[str, object]:
    watchlist_rows = read_csv(dataset_dir / "watchlist.csv")
    company_rows = read_csv(dataset_dir / "company_registry.csv")
    flight_rows = read_csv(dataset_dir / "flight_manifests.csv")
    transaction_rows = read_csv(dataset_dir / "bank_transactions.csv")
    ping_rows = read_jsonl(dataset_dir / "mobile_location_pings.jsonl")
    clinic_path = dataset_dir / "clinic_registrations.csv"
    clinic_rows = read_csv(clinic_path) if clinic_path.exists() else []
    manifest = governance.load_manifest(dataset_dir)

    source_headers = {
        "watchlist.csv": list(watchlist_rows[0].keys()) if watchlist_rows else [],
        "company_registry.csv": list(company_rows[0].keys()) if company_rows else [],
        "flight_manifests.csv": list(flight_rows[0].keys()) if flight_rows else [],
        "bank_transactions.csv": list(transaction_rows[0].keys()) if transaction_rows else [],
        "mobile_location_pings.jsonl": sorted(ping_rows[0].keys()) if ping_rows else [],
        "clinic_registrations.csv": list(clinic_rows[0].keys()) if clinic_rows else [],
    }

    builder = SeedBuilder()

    # Pass 1: resolve every person-bearing record (shared greedy resolver).
    for obs in person_observations(watchlist_rows, company_rows, flight_rows, ping_rows):
        builder.absorb_person(obs)

    # Clinic rows attach by name + dob only, after every other record.
    clinic_attached = attach_clinic_rows(builder.resolver, clinic_rows)
    for person_id, obs in latest_clinic_rows(clinic_attached).items():
        props = builder.entity_index[person_id]["properties"]
        if obs.row.get("home_address"):
            props["homeAddress"] = obs.row["home_address"]
        if obs.row.get("clinic_code"):
            props["clinicCode"] = obs.row["clinic_code"]

    # Pass 2: entities and edges, with person lookups against the final state.
    for row in watchlist_rows:
        person_id = builder.find_person(row.get("canonical_name", ""), row.get("dob", ""), row.get("passport_id", ""),
                                        ref=f"watchlist:{row.get('watchlist_id', '')}")
        record_id = builder.upsert_entity(
            "WatchlistRecord",
            row.get("watchlist_id", ""),
            row.get("watchlist_id", ""),
            {
                "watchlistId": row.get("watchlist_id", ""),
                "alias": row.get("alias", ""),
                "dob": row.get("dob", ""),
                "nationality": row.get("nationality", ""),
                "passportId": row.get("passport_id", ""),
                "riskTag": row.get("risk_tag", ""),
            },
            source_ids=["watchlist.csv"],
        )
        if person_id:
            builder.add_edge("LISTED_ON", person_id, record_id, dedupe_key=f"{person_id}:{record_id}")

    for row in company_rows:
        company_id = builder.ensure_company(
            row.get("company_id", ""),
            row.get("company_name", ""),
            row.get("jurisdiction", ""),
            row.get("incorporation_date", ""),
            row.get("registered_address", ""),
        )
        director_id = builder.find_person(row.get("director_name", ""), row.get("director_dob", ""),
                                          ref=f"company:{row.get('company_id', '')}:director")
        owner_id = builder.find_person(row.get("beneficial_owner", ""), row.get("beneficial_owner_dob", ""),
                                       ref=f"company:{row.get('company_id', '')}:owner")
        location_id = builder.ensure_location(
            row.get("registered_address", ""),
            "",
            "",
            "",
            row.get("registered_site_type", ""),
            row.get("registered_city", ""),
            row.get("registered_country", ""),
        )
        if director_id:
            builder.add_edge("DIRECTS", director_id, company_id, dedupe_key=f"{director_id}:{company_id}")
        if owner_id:
            builder.add_edge("BENEFICIALLY_OWNS", owner_id, company_id, dedupe_key=f"{owner_id}:{company_id}")
        builder.add_edge("REGISTERED_AT", company_id, location_id, dedupe_key=f"{company_id}:{location_id}")

    for row in flight_rows:
        person_id = builder.find_person(
            row.get("passenger_name", ""),
            row.get("dob", ""),
            row.get("passport_id", ""),
            row.get("phone_number", ""),
            ref=f"flight:{row.get('manifest_id', '')}",
        )
        flight_id = builder.upsert_entity(
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
            source_ids=["flight_manifests.csv"],
        )
        departure_airport_id = builder.ensure_airport(row.get("departure_airport", ""))
        arrival_airport_id = builder.ensure_airport(row.get("arrival_airport", ""))
        if person_id:
            builder.add_edge("BOOKED_ON", person_id, flight_id, dedupe_key=f"{person_id}:{flight_id}")
        builder.add_edge("DEPARTED_FROM", flight_id, departure_airport_id, dedupe_key=f"{flight_id}:{departure_airport_id}")
        builder.add_edge("ARRIVED_AT", flight_id, arrival_airport_id, dedupe_key=f"{flight_id}:{arrival_airport_id}")

    for row in transaction_rows:
        source_account_id = row.get("source_account_id", "")
        destination_account_id = row.get("destination_account_id", "")
        if source_account_id:
            source_entity_id = builder.ensure_bank_account(source_account_id, row.get("source_name", ""))
            builder.link_account_owner(source_entity_id, row.get("source_name", ""))
        else:
            source_entity_id = ""
        if destination_account_id:
            destination_entity_id = builder.ensure_bank_account(destination_account_id, row.get("destination_name", ""))
            builder.link_account_owner(destination_entity_id, row.get("destination_name", ""))
        else:
            destination_entity_id = ""
        if source_entity_id and destination_entity_id and row.get("txn_type") == "transfer":
            existing_edge = builder.edge_index.get(f"transferred_to::{slug(f'{source_entity_id}:{destination_entity_id}')}")
            if existing_edge:
                count = int(existing_edge["properties"].get("count", "1")) + 1
                total = float(existing_edge["properties"].get("totalAmountUsd", "0")) + float(row.get("amount_usd", "0") or 0)
                existing_edge["properties"]["count"] = str(count)
                existing_edge["properties"]["totalAmountUsd"] = f"{total:.2f}"
                existing_edge["properties"]["lastTxnTs"] = row.get("txn_ts", "")
            else:
                builder.add_edge(
                    "TRANSFERRED_TO",
                    source_entity_id,
                    destination_entity_id,
                    properties={
                        "count": "1",
                        "totalAmountUsd": row.get("amount_usd", ""),
                        "lastTxnTs": row.get("txn_ts", ""),
                        "sampleReference": row.get("reference", ""),
                    },
                    dedupe_key=f"{source_entity_id}:{destination_entity_id}",
                )

    for row in ping_rows:
        observed_name = str(row.get("observed_name", ""))
        phone_number = str(row.get("phone_number", ""))
        device_id = builder.ensure_device(str(row.get("device_id", "")), phone_number, observed_name)
        person_id = builder.find_person(observed_name, phone_number=phone_number,
                                        ref=f"ping:{row.get('ping_id', '')}")
        if person_id:
            builder.add_edge("USES_DEVICE", person_id, device_id, dedupe_key=f"{person_id}:{device_id}")

        location_id = builder.ensure_location(
            str(row.get("location_label", "")),
            row.get("lat", ""),
            row.get("lon", ""),
            str(row.get("cell_tower", "")),
            str(row.get("location_type", "")),
            str(row.get("city", "")),
            str(row.get("country", "")),
        )
        existing_edge = builder.edge_index.get(f"observed_at::{slug(f'{device_id}:{location_id}')}")
        if existing_edge:
            count = int(existing_edge["properties"].get("sightingCount", "1")) + 1
            existing_edge["properties"]["sightingCount"] = str(count)
            existing_edge["properties"]["lastSeen"] = str(row.get("timestamp", ""))
            existing_edge["properties"]["source"] = merge_value(str(existing_edge["properties"].get("source", "")), str(row.get("source", "")))
        else:
            builder.add_edge(
                "OBSERVED_AT",
                device_id,
                location_id,
                properties={
                    "sightingCount": "1",
                    "firstSeen": str(row.get("timestamp", "")),
                    "lastSeen": str(row.get("timestamp", "")),
                    "source": str(row.get("source", "")),
                },
                dedupe_key=f"{device_id}:{location_id}",
            )

    # Residential Locations + RESIDES_AT from attached clinic rows.
    for obs, person_id in clinic_attached:
        if not person_id:
            continue  # unattached clinic rows create no objects
        row = obs.row
        location_id = builder.ensure_location(
            str(row.get("home_address", "")),
            float(row["lat"]) if row.get("lat") else "",
            float(row["lon"]) if row.get("lon") else "",
            "",
            "residential",
            str(row.get("home_city", "")),
            str(row.get("home_country", "")),
            source_ids=["clinic_registrations.csv"],
        )
        as_of = str(row.get("registered_on", ""))
        existing_edge = builder.edge_index.get(f"resides_at::{slug(f'{person_id}:{location_id}')}")
        if existing_edge:
            if as_of > str(existing_edge["properties"].get("asOf", "")):
                existing_edge["properties"]["asOf"] = as_of
        else:
            builder.add_edge("RESIDES_AT", person_id, location_id,
                             properties={"asOf": as_of, "source": str(row.get("source", ""))},
                             dedupe_key=f"{person_id}:{location_id}")

    builder.finalize_people()
    resolution = candidates.resolution_block(dataset_key, builder.resolver, watchlist_rows, company_rows,
                                             flight_rows, ping_rows)
    governance.annotate_objects(builder.entities, builder.edges, governance.file_markings(manifest))

    sources = [
        {
            "id": "watchlist.csv",
            "name": "Watchlist",
            "file": f"{dataset_path_label}/watchlist.csv",
            "description": "Persons of interest with aliases and risk tags.",
            "recordCount": len(watchlist_rows),
            "fields": source_headers["watchlist.csv"],
        },
        {
            "id": "company_registry.csv",
            "name": "Company Registry",
            "file": f"{dataset_path_label}/company_registry.csv",
            "description": "Companies, directors, beneficial owners, and registered addresses.",
            "recordCount": len(company_rows),
            "fields": source_headers["company_registry.csv"],
        },
        {
            "id": "flight_manifests.csv",
            "name": "Flight Manifests",
            "file": f"{dataset_path_label}/flight_manifests.csv",
            "description": "Passenger manifest rows with booking and travel details.",
            "recordCount": len(flight_rows),
            "fields": source_headers["flight_manifests.csv"],
        },
        {
            "id": "bank_transactions.csv",
            "name": "Bank Transactions",
            "file": f"{dataset_path_label}/bank_transactions.csv",
            "description": "Account activity used to infer owners and transfer flows.",
            "recordCount": len(transaction_rows),
            "fields": source_headers["bank_transactions.csv"],
        },
        {
            "id": "mobile_location_pings.jsonl",
            "name": "Mobile Location Pings",
            "file": f"{dataset_path_label}/mobile_location_pings.jsonl",
            "description": "Device observations that link people, phones, and places.",
            "recordCount": len(ping_rows),
            "fields": source_headers["mobile_location_pings.jsonl"],
        },
        {
            "id": "clinic_registrations.csv",
            "name": "Clinic Registrations",
            "file": f"{dataset_path_label}/clinic_registrations.csv",
            "description": "Patient registrations with home addresses, collected for care (health data).",
            "recordCount": len(clinic_rows),
            "fields": source_headers["clinic_registrations.csv"],
        },
    ]
    for source in sources:
        entry = governance.manifest_entry_for_file(manifest, source["id"])
        source.update(governance.raw_governance(source["id"], entry))
        source["asOf"] = entry.get("asOf", "")

    return {
        "metadata": {
            **build_metadata(dataset_dir, Path(__file__)),
            "title": "Ontology Studio Demo",
            "dataset": dataset_key,
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "description": "Editable ontology seed built from the starter synthetic Palantir-style data sources.",
            "teachingPrompts": [
                "Follow Kareem Haddad across aliases, travel, companies, and banking links.",
                "Inspect why 14 Seabright Ave becomes a meaningful location node shared by multiple companies and people.",
                "Edit a relationship type or add a new property, then watch the graph and instance editor update immediately.",
                "There are two Omar Rahmans. Compare their dates of birth, then lower the resolution threshold to 0.55.",
            ],
        },
        "governance": governance.governance_block(),
        "sources": sources,
        "ontology": {
            "entityTypes": ENTITY_TYPES,
            "relationshipTypes": RELATIONSHIP_TYPES,
            **actions.ontology_block(),
        },
        "resolution": resolution,
        "leads": leads.leads_block(builder.resolver, clinic_rows, ping_rows, company_rows),
        "mappings": build_mappings(source_headers),
        "entities": sorted(builder.entities, key=lambda item: (str(item["type"]), str(item["label"]))),
        "edges": sorted(builder.edges, key=lambda item: (str(item["type"]), str(item["source"]), str(item["target"]))),
    }


def write_seed(output_path: Path, catalog: Dict[str, Dict[str, object]], default_dataset: str) -> None:
    payload = "window.ontologySeedCatalog = " + json.dumps(catalog, indent=2) + ";\n"
    payload += f"window.ontologySeed = window.ontologySeedCatalog[{json.dumps(default_dataset)}];\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(payload, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the browser-ready ontology seed for the demo app.")
    parser.add_argument(
        "--dataset",
        action="append",
        help="Dataset definition in key=path form. Can be repeated. Defaults to starter and simulator.",
    )
    parser.add_argument("--default-dataset", default="starter", help="Dataset key selected by default in the browser app.")
    parser.add_argument("--output", default="demo/seed.js", help="Path to the generated browser seed file.")
    args = parser.parse_args()

    repo_root = REPO_ROOT
    output_path = (repo_root / args.output).resolve()
    dataset_definitions = args.dataset or [
        "starter=synthetic_data/starter",
        "simulator=synthetic_data/simulator",
    ]

    datasets: List[Tuple[str, str]] = []
    for definition in dataset_definitions:
        if "=" in definition:
            key, dataset_path = definition.split("=", 1)
        else:
            dataset_path = definition
            key = Path(definition).name
        datasets.append((key.strip(), dataset_path.strip()))

    catalog: Dict[str, Dict[str, object]] = {}
    for dataset_key, dataset_path in datasets:
        dataset_dir = (repo_root / dataset_path).resolve()
        catalog[dataset_key] = build_seed(dataset_key, dataset_dir, dataset_path)

    default_dataset = args.default_dataset if args.default_dataset in catalog else next(iter(catalog))
    write_seed(output_path, catalog, default_dataset)
    print(f"Wrote ontology seed to {output_path}")
    for dataset_key, seed in catalog.items():
        print(
            f"- {dataset_key}: {len(seed['ontology']['entityTypes'])} entity types, "
            f"{len(seed['ontology']['relationshipTypes'])} relationship types, "
            f"{len(seed['entities'])} entities, {len(seed['edges'])} edges"
        )


if __name__ == "__main__":
    main()
