#!/usr/bin/env python3
"""Generate the linked synthetic sources for one profile (starter or simulator).

Three random streams, so later phases could add data without touching a byte
of the existing rows:

* ``--legacy-seed`` (default 42) drives the five Phase 0 sources (watchlist,
  company registry, flights, bank transactions, pings).  Changing it changes
  every existing file and every entity ID downstream.
* ``--seed`` (default 20260401) drives the Phase 1 clinic registrations
  (``clinic_registrations.csv``) and the residential addresses.
* ``--phase2-seed`` (default 20261104) picks which further noise people get a
  clinic registration in the Phase 2 rework.

Phase 2 (PHASE2_CONTRACT.md §1) appends fixed rows after the Phase 0 rows: the
namesake Omar Rahman (PER-007) and the watchlisted Omar Rahman's LHR-IST
flights, the namesake's rent transfers and (simulator) two namesake pairs.
The clinic rework drops the watchlisted people's registrations.

The script also writes ``manifest.json`` (markings, purpose, legal basis,
retention and as-of date per dataset; values from ``pipeline/governance.py``).
Two runs with the same seeds produce byte-identical files.
"""

import argparse
import csv
import json
import random
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.governance import manifest_for  # noqa: E402


PROFILES = {
    "starter": {
        "extra_people": 12,
        "extra_companies": 6,
        "extra_flights": 16,
        "extra_transactions": 24,
        "extra_pings": 80,
        "residential_addresses": 6,
        "clinic_noise_people": 3,
        "clinic_noise_movers": 0,
        "clinic_unmatched": 0,
    },
    "simulator": {
        "extra_people": 180,
        "extra_companies": 90,
        "extra_flights": 750,
        "extra_transactions": 2200,
        "extra_pings": 6000,
        "residential_addresses": 40,
        "clinic_noise_people": 44,
        "clinic_noise_movers": 6,
        "clinic_unmatched": 4,
    },
}

AIRPORTS = [
    {"code": "ATH", "name": "Athens International Airport", "city": "Athens", "country": "Greece", "lat": 37.9364, "lon": 23.9475},
    {"code": "BEG", "name": "Belgrade Nikola Tesla Airport", "city": "Belgrade", "country": "Serbia", "lat": 44.8184, "lon": 20.3091},
    {"code": "DXB", "name": "Dubai International Airport", "city": "Dubai", "country": "United Arab Emirates", "lat": 25.2532, "lon": 55.3657},
    {"code": "IST", "name": "Istanbul Airport", "city": "Istanbul", "country": "Turkey", "lat": 41.2753, "lon": 28.7519},
    {"code": "LCA", "name": "Larnaca International Airport", "city": "Larnaca", "country": "Cyprus", "lat": 34.8751, "lon": 33.6249},
    {"code": "LHR", "name": "Heathrow Airport", "city": "London", "country": "United Kingdom", "lat": 51.4700, "lon": -0.4543},
    {"code": "SOF", "name": "Sofia Airport", "city": "Sofia", "country": "Bulgaria", "lat": 42.6950, "lon": 23.4062},
    {"code": "VIE", "name": "Vienna International Airport", "city": "Vienna", "country": "Austria", "lat": 48.1103, "lon": 16.5697},
]

LOCATION_POINTS = [
    {"label": "14 Seabright Ave, Limassol", "lat": 34.6796, "lon": 33.0444, "tower": "CY-LIM-014", "location_type": "office", "city": "Limassol", "country": "Cyprus"},
    {"label": "88 Marina Free Zone, Dubai", "lat": 25.0797, "lon": 55.1395, "tower": "AE-DXB-221", "location_type": "free-zone", "city": "Dubai", "country": "United Arab Emirates"},
    {"label": "Larnaca Marina", "lat": 34.9226, "lon": 33.6375, "tower": "CY-LCA-118", "location_type": "marina", "city": "Larnaca", "country": "Cyprus"},
    {"label": "North Quay Warehouse", "lat": 34.6572, "lon": 33.0208, "tower": "CY-LIM-207", "location_type": "warehouse", "city": "Limassol", "country": "Cyprus"},
    {"label": "Geneva Business District", "lat": 46.2044, "lon": 6.1432, "tower": "CH-GVA-055", "location_type": "business-district", "city": "Geneva", "country": "Switzerland"},
]

ADDRESS_POINTS = [
    {"label": "5 Harbor Row, Limassol", "city": "Limassol", "country": "Cyprus", "location_type": "office"},
    {"label": "17 Kingsway, London", "city": "London", "country": "United Kingdom", "location_type": "office"},
    {"label": "9 Al Noor Park, Dubai", "city": "Dubai", "country": "United Arab Emirates", "location_type": "residential"},
    {"label": "48 Bahnhofstrasse, Zurich", "city": "Zurich", "country": "Switzerland", "location_type": "office"},
    {"label": "27 Ringstrasse, Vienna", "city": "Vienna", "country": "Austria", "location_type": "office"},
]

FIRST_NAMES = [
    "Adam", "Aisha", "Ben", "Clara", "Dina", "Elias", "Farah", "Hugo", "Ivy", "Jonah",
    "Lena", "Marcus", "Nadia", "Owen", "Priya", "Rami", "Sara", "Tomas", "Yara", "Zane",
]

LAST_NAMES = [
    "Adler", "Byrne", "Costa", "Demir", "Elias", "Farouk", "Grant", "Hale", "Ionescu", "Keller",
    "Lopez", "Meyer", "Nasser", "Orlov", "Patel", "Quinn", "Rossi", "Silva", "Turner", "Vale",
]

NATIONALITIES = [
    "British", "Cypriot", "Emirati", "German", "Greek", "Indian", "Jordanian", "Lebanese",
    "Romanian", "Serbian", "Swiss", "Turkish",
]

COMPANY_WORDS = [
    "Atlas", "Beacon", "Cedar", "Delta", "Evergreen", "Falcon", "Granite", "Harbor", "Ivory",
    "Juniper", "Keystone", "Lantern", "Meridian", "Nova", "Orchid", "Pioneer", "Quarry", "Ridge",
]

COMPANY_SUFFIXES = ["Advisory", "Holdings", "Logistics", "Maritime", "Partners", "Solutions", "Trading"]

CORE_PEOPLE = [
    {
        "person_id": "PER-001",
        "canonical_name": "Kareem Haddad",
        "aliases": ["Karim Haddad", "K. Haddad"],
        "dob": "1987-04-12",
        "nationality": "Lebanese",
        "passport_id": "P8842101",
        "phone_number": "+971501118890",
        "device_id": "DEV-KH-01",
        "person_account_id": "ACCT-P001",
        "watchlist_id": "WL-1001",
        "risk_tag": "sanctions-evasion",
    },
    {
        "person_id": "PER-002",
        "canonical_name": "Elena Markovic",
        "aliases": ["Jelena Markovic", "E. Markovic"],
        "dob": "1990-11-03",
        "nationality": "Serbian",
        "passport_id": "L1029921",
        "phone_number": "+381642201488",
        "device_id": "DEV-EM-02",
        "person_account_id": "ACCT-P002",
        "watchlist_id": "WL-1002",
        "risk_tag": "procurement-network",
    },
    {
        "person_id": "PER-003",
        "canonical_name": "Omar Rahman",
        "aliases": ["Omar A Rahman", "Omar Al-Rahman"],
        "dob": "1984-08-19",
        "nationality": "Jordanian",
        "passport_id": "N5538219",
        "phone_number": "+447700912410",
        "device_id": "DEV-OR-03",
        "person_account_id": "ACCT-P003",
        "watchlist_id": "WL-1003",
        "risk_tag": "dual-use-broker",
    },
    {
        "person_id": "PER-004",
        "canonical_name": "Sofia Petrov",
        "aliases": ["Sofia Petrova"],
        "dob": "1988-02-27",
        "nationality": "Bulgarian",
        "passport_id": "B7730042",
        "phone_number": "+359883317821",
        "device_id": "DEV-SP-04",
        "person_account_id": "ACCT-P004",
        "watchlist_id": "WL-1004",
        "risk_tag": "facilitator",
    },
    {
        "person_id": "PER-005",
        "canonical_name": "Daniel Wu",
        "aliases": ["Dan Wu"],
        "dob": "1985-06-14",
        "nationality": "American",
        "passport_id": "U2286130",
        "phone_number": "+12025550168",
        "device_id": "DEV-DW-05",
        "person_account_id": "ACCT-P005",
        "watchlist_id": "",
        "risk_tag": "",
    },
    {
        "person_id": "PER-006",
        "canonical_name": "Maya Singh",
        "aliases": ["M. Singh"],
        "dob": "1992-09-21",
        "nationality": "Indian",
        "passport_id": "I6117009",
        "phone_number": "+919845107723",
        "device_id": "DEV-MS-06",
        "person_account_id": "ACCT-P006",
        "watchlist_id": "",
        "risk_tag": "",
    },
]

CORE_COMPANIES = [
    {
        "company_id": "CO-101",
        "company_name": "Oriole Trading LLC",
        "jurisdiction": "Cyprus",
        "incorporation_date": "2021-03-19",
        "registered_address": "14 Seabright Ave, Limassol",
        "director_name": "Elena Markovic",
        "director_dob": "1990-11-03",
        "beneficial_owner": "Kareem Haddad",
        "beneficial_owner_dob": "1987-04-12",
        "company_account_id": "ACCT-C101",
    },
    {
        "company_id": "CO-102",
        "company_name": "North Quay Logistics FZE",
        "jurisdiction": "United Arab Emirates",
        "incorporation_date": "2020-07-08",
        "registered_address": "88 Marina Free Zone, Dubai",
        "director_name": "Omar Rahman",
        "director_dob": "1984-08-19",
        "beneficial_owner": "Kareem Haddad",
        "beneficial_owner_dob": "1987-04-12",
        "company_account_id": "ACCT-C102",
    },
    {
        "company_id": "CO-103",
        "company_name": "Blue Harbor Consulting Ltd",
        "jurisdiction": "Cyprus",
        "incorporation_date": "2022-01-14",
        "registered_address": "14 Seabright Ave, Limassol",
        "director_name": "Sofia Petrov",
        "director_dob": "1988-02-27",
        "beneficial_owner": "Elena Markovic",
        "beneficial_owner_dob": "1990-11-03",
        "company_account_id": "ACCT-C103",
    },
    {
        "company_id": "CO-104",
        "company_name": "Cedar Gate Holdings SA",
        "jurisdiction": "Switzerland",
        "incorporation_date": "2019-11-04",
        "registered_address": "21 Rue des Acacias, Geneva",
        "director_name": "Maya Singh",
        "director_dob": "1992-09-21",
        "beneficial_owner": "Daniel Wu",
        "beneficial_owner_dob": "1985-06-14",
        "company_account_id": "ACCT-C104",
    },
]

BASE_TIME = datetime(2026, 4, 1, 8, 0, tzinfo=timezone.utc)

# ---------------------------------------------------------------------------
# Clinic registrations (Phase 1, PHASE1_CONTRACT.md §4)
# ---------------------------------------------------------------------------

DEFAULT_SEED = 20260401
LEGACY_SEED = 42
CLINIC_SOURCE = "clinic-ehr"

# Home addresses of the core cast (fixed, so the storyline does not depend on
# the seed).  None of these labels appears in the registry or the pings.
CORE_HOMES = {
    "PER-001": {"home_address": "7 Anexartisias Street, Limassol", "home_city": "Limassol", "home_country": "Cyprus",
                "lat": 34.6762, "lon": 33.0427, "clinic_code": "CLN-LIM-02", "registered_on": "2025-09-18"},
    "PER-002": {"home_address": "31 Kralja Petra, Belgrade", "home_city": "Belgrade", "home_country": "Serbia",
                "lat": 44.8196, "lon": 20.4553, "clinic_code": "CLN-BEG-01", "registered_on": "2024-02-06"},
    "PER-003": {"home_address": "22 Cromer Road, London", "home_city": "London", "home_country": "United Kingdom",
                "lat": 51.5462, "lon": -0.1103, "clinic_code": "CLN-LON-04", "registered_on": "2025-11-27"},
    "PER-004": {"home_address": "40 Vitosha Boulevard, Sofia", "home_city": "Sofia", "home_country": "Bulgaria",
                "lat": 42.6909, "lon": 23.3196, "clinic_code": "CLN-SOF-03", "registered_on": "2024-07-15"},
    "PER-005": {"home_address": "1210 Corcoran Street NW, Washington, D.C.", "home_city": "Washington, D.C.",
                "home_country": "United States", "lat": 38.9113, "lon": -77.0287, "clinic_code": "CLN-WAS-01",
                "registered_on": "2023-10-02"},
}
# Kareem Haddad's earlier registration (simulator only): he moved from Dubai.
CORE_EARLIER_HOMES = {
    "PER-001": {"home_address": "12 Al Wasl Gardens, Dubai", "home_city": "Dubai", "home_country": "United Arab Emirates",
                "lat": 25.1972, "lon": 55.2422, "clinic_code": "CLN-DXB-05", "registered_on": "2022-03-09"},
}

RESIDENTIAL_CITIES = [
    {"city": "Limassol", "country": "Cyprus", "code": "LIM", "lat": 34.6841, "lon": 33.0379,
     "streets": ["Makariou Avenue", "Gladstonos Street", "Agias Zonis Street", "Omonoias Avenue"]},
    {"city": "Larnaca", "country": "Cyprus", "code": "LCA", "lat": 34.9167, "lon": 33.6290,
     "streets": ["Ermou Street", "Athinon Avenue", "Grigori Afxentiou Avenue"]},
    {"city": "Dubai", "country": "United Arab Emirates", "code": "DXB", "lat": 25.2048, "lon": 55.2708,
     "streets": ["Al Safa Street", "Al Manara Road", "Umm Suqeim Street"]},
    {"city": "London", "country": "United Kingdom", "code": "LON", "lat": 51.5072, "lon": -0.1276,
     "streets": ["Elgin Crescent", "Mildmay Grove", "Lordship Lane", "Brixton Water Lane"]},
    {"city": "Vienna", "country": "Austria", "code": "VIE", "lat": 48.2082, "lon": 16.3738,
     "streets": ["Josefstaedter Strasse", "Gumpendorfer Strasse", "Praterstrasse"]},
    {"city": "Zurich", "country": "Switzerland", "code": "ZRH", "lat": 47.3769, "lon": 8.5417,
     "streets": ["Seefeldstrasse", "Langstrasse", "Winterthurerstrasse"]},
    {"city": "Athens", "country": "Greece", "code": "ATH", "lat": 37.9838, "lon": 23.7275,
     "streets": ["Patision Street", "Kallidromiou Street", "Solonos Street"]},
    {"city": "Istanbul", "country": "Turkey", "code": "IST", "lat": 41.0082, "lon": 28.9784,
     "streets": ["Bagdat Caddesi", "Halaskargazi Caddesi", "Moda Caddesi"]},
]

# Patients who appear in no other source (simulator only): their rows stay in
# the clinic dataset and never become objects.
UNMATCHED_FIRST = ["Ines", "Pavel", "Leyla", "Georgios", "Hanna", "Tariq"]
UNMATCHED_LAST = ["Moreau", "Novak", "Aydin", "Christou", "Lindqvist", "Bakr"]

# ---------------------------------------------------------------------------
# Phase 2 (PHASE2_CONTRACT.md §1): the namesake, the clinic rework and two
# simulator namesake pairs.
#
# Nothing here is added to CORE_PEOPLE or consumes the legacy random stream:
# the noise generators draw from ``CORE_PEOPLE + noise``, so a seventh core
# person would change every Phase 0 row.  Phase 2 rows are fixed and are
# *appended* after the Phase 0 rows of flight_manifests.csv,
# bank_transactions.csv and (simulator) company_registry.csv, so every
# existing line stays byte-identical.  The only random choice (which extra
# noise people get a clinic registration) uses ``--phase2-seed``.
# ---------------------------------------------------------------------------

PHASE2_SEED = 20261104
CLINIC_NOISE_SHARE = 0.6   # share of noise people with a clinic registration

# PER-007: a care worker in Birmingham who shares a name with the watchlisted
# Omar Rahman (PER-003, passport N5538219).  Nationality and occupation are
# storyline facts; no source file carries them for non-watchlisted people.
NAMESAKE = {
    "person_id": "PER-007",
    "canonical_name": "Omar Rahman",
    "aliases": ["Umar Rahman"],
    "dob": "1979-02-02",
    "nationality": "British",
    "occupation": "care worker",
    "passport_id": "G5510077",
    "phone_number": "+447911223344",
    "person_account_id": "ACCT-P007",
    "watchlist_id": "",
    "risk_tag": "",
    "namesake_of": "PER-003",
}
NAMESAKE_HOME = {"home_address": "41 Oak Lane, Birmingham", "home_city": "Birmingham", "home_country": "United Kingdom",
                 "lat": 52.4421, "lon": -1.9368, "clinic_code": "CLN-BHM-02", "registered_on": "2026-03-12"}
# Maya Singh (PER-006, not watchlisted) also registers with a clinic.
MAYA_HOME = {"home_address": "58 Rue de Carouge, Geneva", "home_city": "Geneva", "home_country": "Switzerland",
             "lat": 46.1934, "lon": 6.1424, "clinic_code": "CLN-GVA-01", "registered_on": "2024-11-05"}

# Watchlisted people: the clinic data must not cover them (spec §5.1 item 2).
WATCHLISTED_KEYS = {(p["canonical_name"], p["dob"]) for p in CORE_PEOPLE if p["watchlist_id"]}

_FLIGHT_KEYS = ["manifest_id", "flight_number", "departure_airport", "arrival_airport", "departure_ts",
                "booking_reference", "passenger_name", "dob", "passport_id", "phone_number", "seat",
                "payment_card_last4"]


def _flight(*values: str) -> Dict[str, str]:
    return dict(zip(_FLIGHT_KEYS, values))


# Both profiles: the watchlisted Omar Rahman flies LHR-IST once; the namesake
# flies the same route out and back, and the return manifest spells him Umar.
PHASE2_FLIGHTS = [
    _flight("MF-0007", "TK-1980", "LHR", "IST", "2026-04-02T06:45:00Z", "PNR47T", "Omar Rahman",
            "1984-08-19", "N5538219", "+447700912410", "21A", "9088"),
    _flight("MF-0008", "TK-1986", "LHR", "IST", "2026-04-04T09:15:00Z", "PNR52H", "Omar Rahman",
            "1979-02-02", "G5510077", "+447911223344", "32C", "6630"),
    _flight("MF-0009", "TK-1971", "IST", "LHR", "2026-04-09T17:30:00Z", "PNR52H", "Umar Rahman",
            "1979-02-02", "G5510077", "+447911223344", "30F", "6630"),
]

# The namesake's rent, paid by bank transfer to his letting agent.  The bank
# writes his name as "Umar Rahman": the transaction feed links an account to a
# person by name only, and "Omar Rahman" already belongs to the watchlisted
# man (whose account ACCT-P003 must keep its owner).
PHASE2_TRANSACTIONS = [
    {"transaction_id": "TX-0009", "source_account_id": "ACCT-P007", "source_name": "Umar Rahman",
     "destination_account_id": "ACCT-L041", "destination_name": "Oak Lane Lettings Ltd", "amount_usd": "910.00",
     "txn_type": "transfer", "merchant_or_bank": "Midland Community Bank", "txn_ts": "2026-03-02T08:05:00Z",
     "reference": "rent March"},
    {"transaction_id": "TX-0010", "source_account_id": "ACCT-P007", "source_name": "Umar Rahman",
     "destination_account_id": "ACCT-L041", "destination_name": "Oak Lane Lettings Ltd", "amount_usd": "910.00",
     "txn_type": "transfer", "merchant_or_bank": "Midland Community Bank", "txn_ts": "2026-04-01T08:05:00Z",
     "reference": "rent April"},
]

# Simulator only: two namesake pairs among the background people.  Each pair is
# the same name written with and without a diacritic (Yılmaz/Yilmaz,
# José/Jose), has two different dates of birth and directs companies at one
# shared address; pair B also shares a flight route.  The pipeline's ASCII
# normaliser keeps them apart; the candidate scorer folds accents and pairs them.
SIM_PAIR_PEOPLE = [
    {"person_id": "NPER-P2A1", "canonical_name": "Mehmet Yılmaz", "dob": "1983-05-17",
     "passport_id": "X3141592", "phone_number": "+905321184407"},
    {"person_id": "NPER-P2A2", "canonical_name": "Mehmet Yilmaz", "dob": "1991-10-02",
     "passport_id": "X2718281", "phone_number": "+491761230045"},
    {"person_id": "NPER-P2B1", "canonical_name": "José Ferreira", "dob": "1979-07-30",
     "passport_id": "X5772156", "phone_number": "+351912345670"},
    {"person_id": "NPER-P2B2", "canonical_name": "Jose Ferreira", "dob": "1986-01-11",
     "passport_id": "X1414213", "phone_number": "+41791234567"},
]
SIM_PAIR_FLIGHTS = [
    # Pair A fly different routes.
    _flight("MF-0101", "TK-1887", "IST", "VIE", "2026-04-05T06:20:00Z", "PNR71K", "Mehmet Yılmaz",
            "1983-05-17", "X3141592", "+905321184407", "11C", "2281"),
    _flight("MF-0102", "OS-836", "VIE", "ATH", "2026-04-07T15:40:00Z", "PNR74D", "Mehmet Yilmaz",
            "1991-10-02", "X2718281", "+491761230045", "19A", "5402"),
    # Pair B share the LCA-ATH route.
    _flight("MF-0103", "A3-911", "LCA", "ATH", "2026-04-03T12:30:00Z", "PNR77S", "José Ferreira",
            "1979-07-30", "X5772156", "+351912345670", "6B", "3318"),
    _flight("MF-0104", "A3-902", "ATH", "LCA", "2026-04-08T10:10:00Z", "PNR79W", "Jose Ferreira",
            "1986-01-11", "X1414213", "+41791234567", "22E", "8840"),
]
# Each pair runs companies registered at one shared (new) address.
SIM_PAIR_COMPANIES = [
    {"company_id": "CO-201", "company_name": "Yilmaz Textiles GmbH", "jurisdiction": "Austria",
     "incorporation_date": "2017-02-08", "registered_address": "12 Mariahilfer Strasse, Vienna",
     "director_name": "Mehmet Yılmaz", "director_dob": "1983-05-17",
     "beneficial_owner": "Mehmet Yılmaz", "beneficial_owner_dob": "1983-05-17",
     "registered_city": "Vienna", "registered_country": "Austria", "registered_site_type": "office"},
    {"company_id": "CO-202", "company_name": "Mariahilf Logistics KG", "jurisdiction": "Austria",
     "incorporation_date": "2024-06-19", "registered_address": "12 Mariahilfer Strasse, Vienna",
     "director_name": "Mehmet Yilmaz", "director_dob": "1991-10-02",
     "beneficial_owner": "Mehmet Yilmaz", "beneficial_owner_dob": "1991-10-02",
     "registered_city": "Vienna", "registered_country": "Austria", "registered_site_type": "office"},
    {"company_id": "CO-203", "company_name": "Ferreira Imports GmbH", "jurisdiction": "Switzerland",
     "incorporation_date": "2018-05-22", "registered_address": "6 Kirchgasse, Zurich",
     "director_name": "José Ferreira", "director_dob": "1979-07-30",
     "beneficial_owner": "José Ferreira", "beneficial_owner_dob": "1979-07-30",
     "registered_city": "Zurich", "registered_country": "Switzerland", "registered_site_type": "office"},
    {"company_id": "CO-204", "company_name": "Kirchgasse Freight AG", "jurisdiction": "Switzerland",
     "incorporation_date": "2023-09-14", "registered_address": "6 Kirchgasse, Zurich",
     "director_name": "Jose Ferreira", "director_dob": "1986-01-11",
     "beneficial_owner": "Jose Ferreira", "beneficial_owner_dob": "1986-01-11",
     "registered_city": "Zurich", "registered_country": "Switzerland", "registered_site_type": "office"},
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate linked synthetic data sources for classroom demos.")
    parser.add_argument("--profile", choices=sorted(PROFILES), default="starter")
    parser.add_argument("--output", default="synthetic_data/starter", help="Directory where files will be written.")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED,
                        help="Seed for the clinic registrations and residential addresses (Phase 1 data).")
    parser.add_argument("--legacy-seed", type=int, default=LEGACY_SEED,
                        help="Seed for the five Phase 0 sources. Changing it changes every existing file.")
    parser.add_argument("--phase2-seed", type=int, default=PHASE2_SEED,
                        help="Seed for the Phase 2 clinic coverage (which extra noise people are registered).")
    return parser.parse_args()


def iso_z(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def choose_name(person: Dict[str, str], rng: random.Random) -> str:
    aliases = person["aliases"]
    if aliases and rng.random() < 0.35:
        return rng.choice(aliases)
    return person["canonical_name"]


def make_noise_people(rng: random.Random, count: int) -> List[Dict[str, str]]:
    people: List[Dict[str, str]] = []
    for index in range(1, count + 1):
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(LAST_NAMES)
        full_name = f"{first} {last}"
        dob = datetime(1974, 1, 1, tzinfo=timezone.utc) + timedelta(days=rng.randint(0, 10000))
        people.append(
            {
                "person_id": f"NPER-{index:03d}",
                "canonical_name": full_name,
                "aliases": [f"{first[0]}. {last}"],
                "dob": dob.date().isoformat(),
                "nationality": rng.choice(NATIONALITIES),
                "passport_id": f"X{rng.randint(1000000, 9999999)}",
                "phone_number": f"+{rng.choice([30, 33, 41, 44, 49, 90, 971])}{rng.randint(10**8, 10**9 - 1)}",
                "device_id": f"DEV-N-{index:03d}",
                "person_account_id": f"ACCT-NP{index:03d}",
                "watchlist_id": "",
                "risk_tag": "",
            }
        )
    return people


def make_noise_companies(rng: random.Random, people: List[Dict[str, str]], count: int) -> List[Dict[str, str]]:
    companies: List[Dict[str, str]] = []
    jurisdictions = ["Cyprus", "Switzerland", "United Arab Emirates", "United Kingdom", "Austria"]
    for index in range(1, count + 1):
        director = rng.choice(people)
        owner = rng.choice(people)
        company_name = f"{rng.choice(COMPANY_WORDS)} {rng.choice(COMPANY_SUFFIXES)} Ltd"
        address = rng.choice(ADDRESS_POINTS)
        companies.append(
            {
                "company_id": f"NCO-{index:03d}",
                "company_name": company_name,
                "jurisdiction": rng.choice(jurisdictions),
                "incorporation_date": (BASE_TIME.date() - timedelta(days=rng.randint(60, 2400))).isoformat(),
                "registered_address": address["label"],
                "registered_city": address["city"],
                "registered_country": address["country"],
                "registered_site_type": address["location_type"],
                "director_name": director["canonical_name"],
                "director_dob": director["dob"],
                "beneficial_owner": owner["canonical_name"],
                "beneficial_owner_dob": owner["dob"],
                "company_account_id": f"ACCT-NC{index:03d}",
            }
        )
    return companies


def build_watchlist_rows() -> List[Dict[str, str]]:
    rows = []
    for person in CORE_PEOPLE:
        if not person["watchlist_id"]:
            continue
        rows.append(
            {
                "watchlist_id": person["watchlist_id"],
                "canonical_name": person["canonical_name"],
                "alias": " | ".join(person["aliases"]),
                "dob": person["dob"],
                "nationality": person["nationality"],
                "passport_id": person["passport_id"],
                "risk_tag": person["risk_tag"],
            }
        )
    return rows


def build_company_rows(profile: str, rng: random.Random, people: List[Dict[str, str]]) -> List[Dict[str, str]]:
    core_companies = []
    company_point_index = {point["label"]: point for point in LOCATION_POINTS + ADDRESS_POINTS}
    for company in CORE_COMPANIES:
        point = company_point_index.get(company["registered_address"], {"city": "", "country": "", "location_type": ""})
        core_companies.append(
            {
                **company,
                "registered_city": point["city"],
                "registered_country": point["country"],
                "registered_site_type": point["location_type"],
            }
        )
    return core_companies + make_noise_companies(rng, people, PROFILES[profile]["extra_companies"])


def build_core_flights() -> List[Dict[str, str]]:
    return [
        {
            "manifest_id": "MF-0001",
            "flight_number": "A3-781",
            "departure_airport": "ATH",
            "arrival_airport": "LCA",
            "departure_ts": "2026-04-03T09:30:00Z",
            "booking_reference": "PNR91X",
            "passenger_name": "Karim Haddad",
            "dob": "1987-04-12",
            "passport_id": "P8842101",
            "phone_number": "+971501118890",
            "seat": "12A",
            "payment_card_last4": "4419",
        },
        {
            "manifest_id": "MF-0002",
            "flight_number": "JU-642",
            "departure_airport": "BEG",
            "arrival_airport": "ATH",
            "departure_ts": "2026-04-03T06:10:00Z",
            "booking_reference": "PNR88K",
            "passenger_name": "Jelena Markovic",
            "dob": "1990-11-03",
            "passport_id": "L1029921",
            "phone_number": "+381642201488",
            "seat": "14C",
            "payment_card_last4": "4419",
        },
        {
            "manifest_id": "MF-0003",
            "flight_number": "TK-1459",
            "departure_airport": "IST",
            "arrival_airport": "LCA",
            "departure_ts": "2026-04-03T11:50:00Z",
            "booking_reference": "PNR20Q",
            "passenger_name": "Omar A Rahman",
            "dob": "1984-08-19",
            "passport_id": "N5538219",
            "phone_number": "+447700912410",
            "seat": "16D",
            "payment_card_last4": "9088",
        },
        {
            "manifest_id": "MF-0004",
            "flight_number": "FB-831",
            "departure_airport": "SOF",
            "arrival_airport": "LCA",
            "departure_ts": "2026-04-04T08:15:00Z",
            "booking_reference": "PNR20Q",
            "passenger_name": "Sofia Petrova",
            "dob": "1988-02-27",
            "passport_id": "B7730042",
            "phone_number": "+359883317821",
            "seat": "18F",
            "payment_card_last4": "4421",
        },
        {
            "manifest_id": "MF-0005",
            "flight_number": "BA-294",
            "departure_airport": "IAD",
            "arrival_airport": "LHR",
            "departure_ts": "2026-04-03T13:10:00Z",
            "booking_reference": "PNR11M",
            "passenger_name": "Daniel Wu",
            "dob": "1985-06-14",
            "passport_id": "U2286130",
            "phone_number": "+12025550168",
            "seat": "9B",
            "payment_card_last4": "7712",
        },
        {
            "manifest_id": "MF-0006",
            "flight_number": "EK-110",
            "departure_airport": "LCA",
            "arrival_airport": "DXB",
            "departure_ts": "2026-04-06T07:20:00Z",
            "booking_reference": "PNR33V",
            "passenger_name": "Kareem Haddad",
            "dob": "1987-04-12",
            "passport_id": "P8842101",
            "phone_number": "+971501118890",
            "seat": "8C",
            "payment_card_last4": "4419",
        },
    ]


def build_noise_flights(rng: random.Random, people: List[Dict[str, str]], count: int) -> List[Dict[str, str]]:
    flights = []
    airports = [airport["code"] for airport in AIRPORTS]
    for index in range(1, count + 1):
        person = rng.choice(people)
        departure = rng.choice(airports)
        arrival = rng.choice([code for code in airports if code != departure])
        departure_ts = BASE_TIME + timedelta(hours=rng.randint(0, 240))
        flights.append(
            {
                "manifest_id": f"NMF-{index:04d}",
                "flight_number": f"{rng.choice(['A3', 'BA', 'EK', 'FB', 'JU', 'LX', 'OS', 'TK'])}-{rng.randint(101, 1799)}",
                "departure_airport": departure,
                "arrival_airport": arrival,
                "departure_ts": iso_z(departure_ts),
                "booking_reference": f"PNR{rng.randint(100, 999)}{rng.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}",
                "passenger_name": choose_name(person, rng),
                "dob": person["dob"],
                "passport_id": person["passport_id"],
                "phone_number": person["phone_number"],
                "seat": f"{rng.randint(1, 28)}{rng.choice('ABCDEF')}",
                "payment_card_last4": f"{rng.randint(1000, 9999)}",
            }
        )
    return flights


def build_core_transactions() -> List[Dict[str, str]]:
    return [
        {
            "transaction_id": "TX-0001",
            "source_account_id": "ACCT-P001",
            "source_name": "Kareem Haddad",
            "destination_account_id": "ACCT-C101",
            "destination_name": "Oriole Trading LLC",
            "amount_usd": "4800.00",
            "txn_type": "transfer",
            "merchant_or_bank": "Mediterranean Commerce Bank",
            "txn_ts": "2026-04-02T19:45:00Z",
            "reference": "consulting retainer",
        },
        {
            "transaction_id": "TX-0002",
            "source_account_id": "ACCT-C101",
            "source_name": "Oriole Trading LLC",
            "destination_account_id": "ACCT-C102",
            "destination_name": "North Quay Logistics FZE",
            "amount_usd": "4700.00",
            "txn_type": "transfer",
            "merchant_or_bank": "Mediterranean Commerce Bank",
            "txn_ts": "2026-04-03T14:05:00Z",
            "reference": "freight adjustment",
        },
        {
            "transaction_id": "TX-0003",
            "source_account_id": "ACCT-P003",
            "source_name": "Omar Rahman",
            "destination_account_id": "ACCT-P004",
            "destination_name": "Sofia Petrov",
            "amount_usd": "4500.00",
            "txn_type": "transfer",
            "merchant_or_bank": "Halcyon Private Bank",
            "txn_ts": "2026-04-03T16:20:00Z",
            "reference": "invoice 447",
        },
        {
            "transaction_id": "TX-0004",
            "source_account_id": "ACCT-P004",
            "source_name": "Sofia Petrov",
            "destination_account_id": "ACCT-C103",
            "destination_name": "Blue Harbor Consulting Ltd",
            "amount_usd": "4300.00",
            "txn_type": "transfer",
            "merchant_or_bank": "Halcyon Private Bank",
            "txn_ts": "2026-04-04T12:10:00Z",
            "reference": "retainer",
        },
        {
            "transaction_id": "TX-0005",
            "source_account_id": "ACCT-P002",
            "source_name": "Elena Markovic",
            "destination_account_id": "",
            "destination_name": "Cash withdrawal",
            "amount_usd": "9800.00",
            "txn_type": "cash_withdrawal",
            "merchant_or_bank": "ATM-CY-09",
            "txn_ts": "2026-04-03T18:45:00Z",
            "reference": "cash",
        },
        {
            "transaction_id": "TX-0006",
            "source_account_id": "ACCT-C102",
            "source_name": "North Quay Logistics FZE",
            "destination_account_id": "ACCT-C103",
            "destination_name": "Blue Harbor Consulting Ltd",
            "amount_usd": "4250.00",
            "txn_type": "transfer",
            "merchant_or_bank": "Marina Trade Bank",
            "txn_ts": "2026-04-04T13:55:00Z",
            "reference": "service fee",
        },
        {
            "transaction_id": "TX-0007",
            "source_account_id": "ACCT-P001",
            "source_name": "Kareem Haddad",
            "destination_account_id": "ACCT-P002",
            "destination_name": "Elena Markovic",
            "amount_usd": "1995.00",
            "txn_type": "transfer",
            "merchant_or_bank": "Mediterranean Commerce Bank",
            "txn_ts": "2026-04-05T09:25:00Z",
            "reference": "expense settle",
        },
        {
            "transaction_id": "TX-0008",
            "source_account_id": "ACCT-P005",
            "source_name": "Daniel Wu",
            "destination_account_id": "",
            "destination_name": "SkyJet Travel",
            "amount_usd": "1890.00",
            "txn_type": "card_purchase",
            "merchant_or_bank": "SkyJet Travel",
            "txn_ts": "2026-04-02T08:30:00Z",
            "reference": "corporate itinerary",
        },
    ]


def build_noise_transactions(
    rng: random.Random,
    people: List[Dict[str, str]],
    companies: List[Dict[str, str]],
    count: int,
) -> List[Dict[str, str]]:
    rows = []
    merchants = ["Airport Retail", "City Fuel", "Hotel Azure", "Metro Taxi", "Nova Telecom", "Office Supply Hub"]
    party_pool = people + companies
    for index in range(1, count + 1):
        source = rng.choice(party_pool)
        txn_type = rng.choice(["transfer", "card_purchase", "cash_withdrawal"])
        destination = rng.choice(party_pool) if txn_type == "transfer" else None
        txn_ts = BASE_TIME + timedelta(hours=rng.randint(0, 260), minutes=rng.randint(0, 59))
        amount = rng.choice([48.50, 72.20, 118.00, 245.75, 880.00, 1250.00, 3225.00])
        source_account = source.get("person_account_id") or source.get("company_account_id") or ""
        source_name = source.get("canonical_name") or source.get("company_name") or ""
        if destination:
            destination_account = destination.get("person_account_id") or destination.get("company_account_id") or ""
            destination_name = destination.get("canonical_name") or destination.get("company_name") or ""
            merchant = rng.choice(["Halcyon Private Bank", "Mediterranean Commerce Bank", "Marina Trade Bank"])
        elif txn_type == "cash_withdrawal":
            destination_account = ""
            destination_name = "Cash withdrawal"
            merchant = f"ATM-{rng.choice(['AT', 'CY', 'GB', 'TR', 'AE'])}-{rng.randint(10, 99)}"
        else:
            destination_account = ""
            destination_name = rng.choice(merchants)
            merchant = destination_name

        rows.append(
            {
                "transaction_id": f"NTX-{index:05d}",
                "source_account_id": source_account,
                "source_name": source_name,
                "destination_account_id": destination_account,
                "destination_name": destination_name,
                "amount_usd": f"{amount:.2f}",
                "txn_type": txn_type,
                "merchant_or_bank": merchant,
                "txn_ts": iso_z(txn_ts),
                "reference": rng.choice(["ops", "invoice", "travel", "fuel", "hotel", "settlement"]),
            }
        )
    return rows


def location_for_airport(code: str) -> Dict[str, str]:
    airport = next(airport for airport in AIRPORTS if airport["code"] == code)
    return {
        "label": airport["name"],
        "lat": airport["lat"],
        "lon": airport["lon"],
        "tower": f"{code}-AIRPORT",
        "location_type": "airport",
        "city": airport["city"],
        "country": airport["country"],
    }


def build_core_pings() -> List[Dict[str, str]]:
    return [
        {
            "ping_id": "PG-0001",
            "device_id": "DEV-EM-02",
            "observed_name": "Jelena Markovic",
            "phone_number": "+381642201488",
            "timestamp": "2026-04-03T05:18:00Z",
            "lat": 44.8184,
            "lon": 20.3091,
            "cell_tower": "BEG-AIRPORT",
            "location_label": "Belgrade Nikola Tesla Airport",
            "location_type": "airport",
            "city": "Belgrade",
            "country": "Serbia",
            "source": "handset-triangulation",
        },
        {
            "ping_id": "PG-0002",
            "device_id": "DEV-KH-01",
            "observed_name": "Karim Haddad",
            "phone_number": "+971501118890",
            "timestamp": "2026-04-03T07:42:00Z",
            "lat": 37.9364,
            "lon": 23.9475,
            "cell_tower": "ATH-AIRPORT",
            "location_label": "Athens International Airport",
            "location_type": "airport",
            "city": "Athens",
            "country": "Greece",
            "source": "handset-triangulation",
        },
        {
            "ping_id": "PG-0003",
            "device_id": "DEV-EM-02",
            "observed_name": "Elena Markovic",
            "phone_number": "+381642201488",
            "timestamp": "2026-04-03T07:48:00Z",
            "lat": 37.9364,
            "lon": 23.9475,
            "cell_tower": "ATH-AIRPORT",
            "location_label": "Athens International Airport",
            "location_type": "airport",
            "city": "Athens",
            "country": "Greece",
            "source": "app-sdk",
        },
        {
            "ping_id": "PG-0004",
            "device_id": "DEV-KH-01",
            "observed_name": "Kareem Haddad",
            "phone_number": "+971501118890",
            "timestamp": "2026-04-03T15:27:00Z",
            "lat": 34.9226,
            "lon": 33.6375,
            "cell_tower": "CY-LCA-118",
            "location_label": "Larnaca Marina",
            "location_type": "marina",
            "city": "Larnaca",
            "country": "Cyprus",
            "source": "handset-triangulation",
        },
        {
            "ping_id": "PG-0005",
            "device_id": "DEV-OR-03",
            "observed_name": "Omar Rahman",
            "phone_number": "+447700912410",
            "timestamp": "2026-04-03T16:06:00Z",
            "lat": 34.9226,
            "lon": 33.6375,
            "cell_tower": "CY-LCA-118",
            "location_label": "Larnaca Marina",
            "location_type": "marina",
            "city": "Larnaca",
            "country": "Cyprus",
            "source": "handset-triangulation",
        },
        {
            "ping_id": "PG-0006",
            "device_id": "DEV-EM-02",
            "observed_name": "Elena Markovic",
            "phone_number": "+381642201488",
            "timestamp": "2026-04-03T19:31:00Z",
            "lat": 34.6796,
            "lon": 33.0444,
            "cell_tower": "CY-LIM-014",
            "location_label": "14 Seabright Ave, Limassol",
            "location_type": "office",
            "city": "Limassol",
            "country": "Cyprus",
            "source": "app-sdk",
        },
        {
            "ping_id": "PG-0007",
            "device_id": "DEV-KH-01",
            "observed_name": "Kareem Haddad",
            "phone_number": "+971501118890",
            "timestamp": "2026-04-03T19:34:00Z",
            "lat": 34.6796,
            "lon": 33.0444,
            "cell_tower": "CY-LIM-014",
            "location_label": "14 Seabright Ave, Limassol",
            "location_type": "office",
            "city": "Limassol",
            "country": "Cyprus",
            "source": "app-sdk",
        },
        {
            "ping_id": "PG-0008",
            "device_id": "DEV-SP-04",
            "observed_name": "Sofia Petrov",
            "phone_number": "+359883317821",
            "timestamp": "2026-04-04T13:07:00Z",
            "lat": 34.6796,
            "lon": 33.0444,
            "cell_tower": "CY-LIM-014",
            "location_label": "14 Seabright Ave, Limassol",
            "location_type": "office",
            "city": "Limassol",
            "country": "Cyprus",
            "source": "handset-triangulation",
        },
        {
            "ping_id": "PG-0009",
            "device_id": "DEV-KH-01",
            "observed_name": "Kareem Haddad",
            "phone_number": "+971501118890",
            "timestamp": "2026-04-06T10:41:00Z",
            "lat": 25.0797,
            "lon": 55.1395,
            "cell_tower": "AE-DXB-221",
            "location_label": "88 Marina Free Zone, Dubai",
            "location_type": "free-zone",
            "city": "Dubai",
            "country": "United Arab Emirates",
            "source": "app-sdk",
        },
    ]


def build_noise_pings(rng: random.Random, people: List[Dict[str, str]], count: int) -> List[Dict[str, str]]:
    rows = []
    points = LOCATION_POINTS + [location_for_airport(airport["code"]) for airport in AIRPORTS]
    for index in range(1, count + 1):
        person = rng.choice(people)
        point = rng.choice(points)
        timestamp = BASE_TIME + timedelta(hours=rng.randint(0, 260), minutes=rng.randint(0, 59))
        rows.append(
            {
                "ping_id": f"NPG-{index:05d}",
                "device_id": person["device_id"],
                "observed_name": choose_name(person, rng),
                "phone_number": person["phone_number"],
                "timestamp": iso_z(timestamp),
                "lat": round(point["lat"] + rng.uniform(-0.01, 0.01), 6),
                "lon": round(point["lon"] + rng.uniform(-0.01, 0.01), 6),
                "cell_tower": point["tower"],
                "location_label": point["label"],
                "location_type": point["location_type"],
                "city": point["city"],
                "country": point["country"],
                "source": rng.choice(["app-sdk", "handset-triangulation", "carrier-feed"]),
            }
        )
    return rows


def build_residential_addresses(rng: random.Random, count: int, taken: Set[str]) -> List[Dict[str, object]]:
    """``count`` distinct residential addresses whose labels collide with no known place."""
    addresses: List[Dict[str, object]] = []
    labels = set(taken)
    while len(addresses) < count:
        city = RESIDENTIAL_CITIES[len(addresses) % len(RESIDENTIAL_CITIES)]
        street = rng.choice(city["streets"])
        label = f"{rng.randint(2, 180)} {street}, {city['city']}"
        if label in labels:
            continue
        labels.add(label)
        addresses.append({
            "home_address": label,
            "home_city": city["city"],
            "home_country": city["country"],
            "lat": round(city["lat"] + rng.uniform(-0.02, 0.02), 6),
            "lon": round(city["lon"] + rng.uniform(-0.02, 0.02), 6),
            "clinic_code": f"CLN-{city['code']}-{rng.randint(1, 6):02d}",
        })
    return addresses


def _registered_on(rng: random.Random, start: date, end: date) -> str:
    return (start + timedelta(days=rng.randint(0, (end - start).days))).isoformat()


def build_clinic_rows(
    profile: str,
    rng: random.Random,
    people: List[Dict[str, str]],
    company_rows: List[Dict[str, str]],
    flight_rows: List[Dict[str, str]],
    known_labels: Set[str],
) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    """Phase 1 clinic registrations: a few core people, some noise people, and
    (simulator) a few patients who appear nowhere else.  Returns the rows and
    the residential address pool.  Phase 2 then drops the watchlisted people's
    rows and appends more (:func:`phase2_clinic_rows`).

    Every matched patient is written with a name and date of birth that some
    registry or flight record also carries, so the shared resolver can attach
    the row by name + dob.  Rows are never the only evidence for a person.
    """
    settings = PROFILES[profile]
    addresses = build_residential_addresses(rng, settings["residential_addresses"], known_labels)
    named_with_dob: Set[Tuple[str, str]] = set()
    for row in company_rows:
        named_with_dob.add((row["director_name"], row["director_dob"]))
        named_with_dob.add((row["beneficial_owner"], row["beneficial_owner_dob"]))
    for row in flight_rows:
        named_with_dob.add((row["passenger_name"], row["dob"]))

    rows: List[Dict[str, object]] = []

    def add(name: str, dob: str, home: Dict[str, object], registered_on: str) -> None:
        rows.append({
            "registration_id": "",
            "patient_name": name,
            "dob": dob,
            "home_address": home["home_address"],
            "home_city": home["home_city"],
            "home_country": home["home_country"],
            "lat": home["lat"],
            "lon": home["lon"],
            "clinic_code": home["clinic_code"],
            "registered_on": registered_on,
            "source": CLINIC_SOURCE,
        })

    core = {person["person_id"]: person for person in CORE_PEOPLE}
    for pid, home in CORE_HOMES.items():
        add(core[pid]["canonical_name"], core[pid]["dob"], home, str(home["registered_on"]))
    if profile != "starter":
        for pid, home in CORE_EARLIER_HOMES.items():
            add(core[pid]["canonical_name"], core[pid]["dob"], home, str(home["registered_on"]))

    core_ids = set(core)
    eligible = [p for p in people
                if p["person_id"] not in core_ids and (p["canonical_name"], p["dob"]) in named_with_dob]
    chosen = rng.sample(eligible, min(settings["clinic_noise_people"], len(eligible)))
    for person in chosen:
        add(person["canonical_name"], person["dob"], rng.choice(addresses),
            _registered_on(rng, date(2022, 1, 1), date(2026, 3, 20)))
    # Movers: a second, later registration at another address.
    for person in chosen[: settings["clinic_noise_movers"]]:
        add(person["canonical_name"], person["dob"], rng.choice(addresses),
            _registered_on(rng, date(2026, 1, 1), date(2026, 3, 31)))

    taken_pairs = {(p["canonical_name"], p["dob"]) for p in people}
    for _ in range(settings["clinic_unmatched"]):
        while True:
            name = f"{rng.choice(UNMATCHED_FIRST)} {rng.choice(UNMATCHED_LAST)}"
            dob = (date(1950, 1, 1) + timedelta(days=rng.randint(0, 20000))).isoformat()
            if (name, dob) not in taken_pairs:
                taken_pairs.add((name, dob))
                break
        add(name, dob, rng.choice(addresses), _registered_on(rng, date(2022, 1, 1), date(2026, 3, 20)))

    rows.sort(key=lambda row: (str(row["registered_on"]), str(row["patient_name"])))
    for index, row in enumerate(rows, start=1):
        row["registration_id"] = f"REG-{index:04d}"
    return rows, addresses


def _clinic_row(name: str, dob: str, home: Dict[str, object], registered_on: str) -> Dict[str, object]:
    return {
        "registration_id": "",
        "patient_name": name,
        "dob": dob,
        "home_address": home["home_address"],
        "home_city": home["home_city"],
        "home_country": home["home_country"],
        "lat": home["lat"],
        "lon": home["lon"],
        "clinic_code": home["clinic_code"],
        "registered_on": registered_on,
        "source": CLINIC_SOURCE,
    }


def phase2_clinic_rows(
    phase1_rows: List[Dict[str, object]],
    addresses: List[Dict[str, object]],
    rng: random.Random,
    noise_people: List[Dict[str, str]],
    company_rows: List[Dict[str, str]],
    flight_rows: List[Dict[str, str]],
) -> List[Dict[str, object]]:
    """The clinic rework (PHASE2_CONTRACT.md §1).

    * Rows of the four watchlisted people are removed (their registration IDs
      are not reused, so the file shows the gaps).  Every other Phase 1 row is
      kept unchanged.
    * New rows, numbered after the last Phase 1 ID: the namesake, Maya Singh,
      and enough further noise people for about 60% of all noise people to be
      registered.  Only people whose name and date of birth some registry or
      flight record carries are eligible, so every new row attaches to a Person.
    """
    kept = [row for row in phase1_rows if (row["patient_name"], row["dob"]) not in WATCHLISTED_KEYS]
    covered = {(str(row["patient_name"]), str(row["dob"])) for row in phase1_rows}
    named_with_dob: Set[Tuple[str, str]] = set()
    for row in company_rows:
        named_with_dob.add((row["director_name"], row["director_dob"]))
        named_with_dob.add((row["beneficial_owner"], row["beneficial_owner_dob"]))
    for row in flight_rows:
        named_with_dob.add((row["passenger_name"], row["dob"]))

    new_rows = [
        _clinic_row(NAMESAKE["canonical_name"], NAMESAKE["dob"], NAMESAKE_HOME, str(NAMESAKE_HOME["registered_on"])),
        _clinic_row("Maya Singh", "1992-09-21", MAYA_HOME, str(MAYA_HOME["registered_on"])),
    ]
    target = round(CLINIC_NOISE_SHARE * len(noise_people))
    already = sum(1 for p in noise_people if (p["canonical_name"], p["dob"]) in covered)
    eligible = [p for p in noise_people
                if (p["canonical_name"], p["dob"]) not in covered and (p["canonical_name"], p["dob"]) in named_with_dob]
    chosen = rng.sample(eligible, min(max(target - already, 0), len(eligible)))
    for person in chosen:
        new_rows.append(_clinic_row(person["canonical_name"], person["dob"], rng.choice(addresses),
                                    _registered_on(rng, date(2022, 1, 1), date(2026, 3, 20))))
    new_rows.sort(key=lambda row: (str(row["registered_on"]), str(row["patient_name"])))
    start = len(phase1_rows) + 1
    for index, row in enumerate(new_rows, start=start):
        row["registration_id"] = f"REG-{index:04d}"
    return kept + new_rows


def append_rows(rows: List[Dict[str, str]], extra: List[Dict[str, str]]) -> List[Dict[str, str]]:
    """Phase 0 rows unchanged and in order, then the Phase 2 rows (same columns)."""
    if rows:
        keys = list(rows[0].keys())
        for row in extra:
            assert list(row.keys()) == keys, (keys, list(row.keys()))
    return rows + extra


def _max_date(values: List[str], fallback: str) -> str:
    dates = [v[:10] for v in values if v]
    return max(dates) if dates else fallback


def write_manifest(path: Path, as_of: Dict[str, str]) -> None:
    path.write_text(json.dumps(manifest_for(as_of), indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, rows: List[Dict[str, str]]) -> None:
    if not rows:
        return
    # LF line endings: the files are committed with LF (.gitattributes text=auto),
    # so a fresh run is byte-identical to the checkout.
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()), lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def write_jsonl(path: Path, rows: List[Dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True))
            handle.write("\n")


def main() -> None:
    args = parse_args()
    rng = random.Random(args.legacy_seed)
    clinic_rng = random.Random(args.seed)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    people = CORE_PEOPLE + make_noise_people(rng, PROFILES[args.profile]["extra_people"])
    companies = build_company_rows(args.profile, rng, people)

    watchlist_rows = build_watchlist_rows()
    company_rows = [{key: value for key, value in company.items() if key != "company_account_id"} for company in companies]
    flight_rows = build_core_flights() + build_noise_flights(rng, people, PROFILES[args.profile]["extra_flights"])
    transaction_rows = build_core_transactions() + build_noise_transactions(
        rng,
        people,
        companies,
        PROFILES[args.profile]["extra_transactions"],
    )
    ping_rows = build_core_pings() + build_noise_pings(rng, people, PROFILES[args.profile]["extra_pings"])

    flight_rows.sort(key=lambda row: row["departure_ts"])
    transaction_rows.sort(key=lambda row: row["txn_ts"])
    ping_rows.sort(key=lambda row: row["timestamp"])
    noise_people = people[len(CORE_PEOPLE):]
    phase1_company_rows = company_rows
    phase1_flight_rows = flight_rows

    # Phase 2: fixed rows appended after the Phase 0 rows (no RNG involved).
    flight_rows = append_rows(flight_rows, PHASE2_FLIGHTS + (SIM_PAIR_FLIGHTS if args.profile == "simulator" else []))
    transaction_rows = append_rows(transaction_rows, PHASE2_TRANSACTIONS)
    if args.profile == "simulator":
        company_rows = append_rows(company_rows, SIM_PAIR_COMPANIES)
        noise_people = noise_people + [
            {**p, "aliases": [], "nationality": "", "device_id": "", "person_account_id": "",
             "watchlist_id": "", "risk_tag": ""} for p in SIM_PAIR_PEOPLE
        ]

    write_csv(output_dir / "watchlist.csv", watchlist_rows)
    write_csv(output_dir / "company_registry.csv", company_rows)
    write_csv(output_dir / "flight_manifests.csv", flight_rows)
    write_csv(output_dir / "bank_transactions.csv", transaction_rows)
    write_jsonl(output_dir / "mobile_location_pings.jsonl", ping_rows)

    # Phase 1: clinic registrations from their own random stream (the legacy
    # stream above is not consumed any further, so earlier files are unchanged).
    known_labels = {point["label"] for point in LOCATION_POINTS + ADDRESS_POINTS}
    known_labels.update(row["registered_address"] for row in company_rows)
    known_labels.update(row["location_label"] for row in ping_rows)
    known_labels.update(home["home_address"] for home in list(CORE_HOMES.values()) + list(CORE_EARLIER_HOMES.values()))
    known_labels.add(str(NAMESAKE_HOME["home_address"]))
    known_labels.add(str(MAYA_HOME["home_address"]))
    phase1_clinic, addresses = build_clinic_rows(args.profile, clinic_rng, people, phase1_company_rows,
                                                 phase1_flight_rows, known_labels)
    clinic_rows = phase2_clinic_rows(phase1_clinic, addresses, random.Random(args.phase2_seed), noise_people,
                                     company_rows, flight_rows)
    write_csv(output_dir / "clinic_registrations.csv", clinic_rows)

    base_date = BASE_TIME.date().isoformat()
    write_manifest(output_dir / "manifest.json", {
        "watchlist": base_date,
        "company_registry": base_date,
        "flight_manifests": _max_date([row["departure_ts"] for row in flight_rows], base_date),
        "bank_transactions": _max_date([row["txn_ts"] for row in transaction_rows], base_date),
        "mobile_location_pings": _max_date([str(row["timestamp"]) for row in ping_rows], base_date),
        "clinic_registrations": _max_date([str(row["registered_on"]) for row in clinic_rows], base_date),
    })

    print(f"Wrote starter files to {output_dir}" if args.profile == "starter" else f"Wrote simulator files to {output_dir}")
    print(f"- watchlist.csv: {len(watchlist_rows)} rows")
    print(f"- company_registry.csv: {len(company_rows)} rows")
    print(f"- flight_manifests.csv: {len(flight_rows)} rows")
    print(f"- bank_transactions.csv: {len(transaction_rows)} rows")
    print(f"- mobile_location_pings.jsonl: {len(ping_rows)} rows")
    print(f"- clinic_registrations.csv: {len(clinic_rows)} rows")
    print("- manifest.json")


if __name__ == "__main__":
    main()
