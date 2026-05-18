#!/usr/bin/env python3

import argparse
import csv
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List


PROFILES = {
    "starter": {
        "extra_people": 12,
        "extra_companies": 6,
        "extra_flights": 16,
        "extra_transactions": 24,
        "extra_pings": 80,
    },
    "simulator": {
        "extra_people": 180,
        "extra_companies": 90,
        "extra_flights": 750,
        "extra_transactions": 2200,
        "extra_pings": 6000,
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate linked synthetic data sources for classroom demos.")
    parser.add_argument("--profile", choices=sorted(PROFILES), default="starter")
    parser.add_argument("--output", default="synthetic_data/starter", help="Directory where files will be written.")
    parser.add_argument("--seed", type=int, default=42)
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


def write_csv(path: Path, rows: List[Dict[str, str]]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def write_jsonl(path: Path, rows: List[Dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, sort_keys=True))
            handle.write("\n")


def main() -> None:
    args = parse_args()
    rng = random.Random(args.seed)
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

    write_csv(output_dir / "watchlist.csv", watchlist_rows)
    write_csv(output_dir / "company_registry.csv", company_rows)
    write_csv(output_dir / "flight_manifests.csv", flight_rows)
    write_csv(output_dir / "bank_transactions.csv", transaction_rows)
    write_jsonl(output_dir / "mobile_location_pings.jsonl", ping_rows)

    print(f"Wrote starter files to {output_dir}" if args.profile == "starter" else f"Wrote simulator files to {output_dir}")
    print(f"- watchlist.csv: {len(watchlist_rows)} rows")
    print(f"- company_registry.csv: {len(company_rows)} rows")
    print(f"- flight_manifests.csv: {len(flight_rows)} rows")
    print(f"- bank_transactions.csv: {len(transaction_rows)} rows")
    print(f"- mobile_location_pings.jsonl: {len(ping_rows)} rows")


if __name__ == "__main__":
    main()
