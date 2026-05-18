"""
pipeline/01_normalize_sources.py — Read and normalize all five raw source files.

For each source:
- Strip whitespace from all string fields
- Parse date/datetime strings to ISO format (leave as-is if already ISO)
- Split pipe-delimited alias fields into Python lists
- Tag each row with its original 0-based row index as ``_source_row``

Returns five Dataset objects (one per source file).
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Allow imports from the repo root when run directly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.lib import Dataset


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _strip(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip()
    return value


def _clean_row(row: Dict[str, Any]) -> Dict[str, Any]:
    return {k: _strip(v) for k, v in row.items()}


def read_csv_raw(path: Path) -> List[Dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def read_jsonl_raw(path: Path) -> List[Dict[str, Any]]:
    with path.open(encoding="utf-8") as fh:
        return [json.loads(line) for line in fh if line.strip()]


# ---------------------------------------------------------------------------
# Per-source normalizers
# ---------------------------------------------------------------------------

def normalize_watchlist(path: Path) -> Dataset:
    """watchlist.csv → cleaned rows with aliases as list."""
    rows = read_csv_raw(path)
    out: List[Dict[str, Any]] = []
    for i, row in enumerate(rows):
        row = _clean_row(row)
        # Split pipe-delimited aliases
        raw_alias = row.get("alias", "")
        alias_list = [a.strip() for a in raw_alias.split("|") if a.strip()] if raw_alias else []
        out.append({
            "_source_row": i,
            "watchlist_id": row.get("watchlist_id", ""),
            "canonical_name": row.get("canonical_name", ""),
            "aliases": alias_list,
            "dob": row.get("dob", ""),
            "nationality": row.get("nationality", ""),
            "passport_id": row.get("passport_id", ""),
            "risk_tag": row.get("risk_tag", ""),
        })
    schema = [
        {"field": "_source_row", "type": "integer"},
        {"field": "watchlist_id", "type": "string"},
        {"field": "canonical_name", "type": "string"},
        {"field": "aliases", "type": "json"},
        {"field": "dob", "type": "date"},
        {"field": "nationality", "type": "string"},
        {"field": "passport_id", "type": "string"},
        {"field": "risk_tag", "type": "string"},
    ]
    return Dataset(
        name="norm_watchlist",
        rows=out,
        source_file="synthetic_data/starter/watchlist.csv",
        schema=schema,
    )


def normalize_company_registry(path: Path) -> Dataset:
    """company_registry.csv → cleaned rows."""
    rows = read_csv_raw(path)
    out: List[Dict[str, Any]] = []
    for i, row in enumerate(rows):
        row = _clean_row(row)
        out.append({
            "_source_row": i,
            "company_id": row.get("company_id", ""),
            "company_name": row.get("company_name", ""),
            "jurisdiction": row.get("jurisdiction", ""),
            "incorporation_date": row.get("incorporation_date", ""),
            "registered_address": row.get("registered_address", ""),
            "director_name": row.get("director_name", ""),
            "director_dob": row.get("director_dob", ""),
            "beneficial_owner": row.get("beneficial_owner", ""),
            "beneficial_owner_dob": row.get("beneficial_owner_dob", ""),
            "registered_city": row.get("registered_city", ""),
            "registered_country": row.get("registered_country", ""),
            "registered_site_type": row.get("registered_site_type", ""),
        })
    schema = [
        {"field": "_source_row", "type": "integer"},
        {"field": "company_id", "type": "string"},
        {"field": "company_name", "type": "string"},
        {"field": "jurisdiction", "type": "string"},
        {"field": "incorporation_date", "type": "date"},
        {"field": "registered_address", "type": "string"},
        {"field": "director_name", "type": "string"},
        {"field": "director_dob", "type": "date"},
        {"field": "beneficial_owner", "type": "string"},
        {"field": "beneficial_owner_dob", "type": "date"},
        {"field": "registered_city", "type": "string"},
        {"field": "registered_country", "type": "string"},
        {"field": "registered_site_type", "type": "string"},
    ]
    return Dataset(
        name="norm_company_registry",
        rows=out,
        source_file="synthetic_data/starter/company_registry.csv",
        schema=schema,
    )


def normalize_flight_manifests(path: Path) -> Dataset:
    """flight_manifests.csv → cleaned rows."""
    rows = read_csv_raw(path)
    out: List[Dict[str, Any]] = []
    for i, row in enumerate(rows):
        row = _clean_row(row)
        out.append({
            "_source_row": i,
            "manifest_id": row.get("manifest_id", ""),
            "flight_number": row.get("flight_number", ""),
            "departure_airport": row.get("departure_airport", ""),
            "arrival_airport": row.get("arrival_airport", ""),
            "departure_ts": row.get("departure_ts", ""),
            "booking_reference": row.get("booking_reference", ""),
            "passenger_name": row.get("passenger_name", ""),
            "dob": row.get("dob", ""),
            "passport_id": row.get("passport_id", ""),
            "phone_number": row.get("phone_number", ""),
            "seat": row.get("seat", ""),
            "payment_card_last4": row.get("payment_card_last4", ""),
        })
    schema = [
        {"field": "_source_row", "type": "integer"},
        {"field": "manifest_id", "type": "string"},
        {"field": "flight_number", "type": "string"},
        {"field": "departure_airport", "type": "string"},
        {"field": "arrival_airport", "type": "string"},
        {"field": "departure_ts", "type": "date"},
        {"field": "booking_reference", "type": "string"},
        {"field": "passenger_name", "type": "string"},
        {"field": "dob", "type": "date"},
        {"field": "passport_id", "type": "string"},
        {"field": "phone_number", "type": "string"},
        {"field": "seat", "type": "string"},
        {"field": "payment_card_last4", "type": "string"},
    ]
    return Dataset(
        name="norm_flight_manifests",
        rows=out,
        source_file="synthetic_data/starter/flight_manifests.csv",
        schema=schema,
    )


def normalize_bank_transactions(path: Path) -> Dataset:
    """bank_transactions.csv → cleaned rows with numeric amount."""
    rows = read_csv_raw(path)
    out: List[Dict[str, Any]] = []
    for i, row in enumerate(rows):
        row = _clean_row(row)
        amount_raw = row.get("amount_usd", "")
        try:
            amount = float(amount_raw) if amount_raw else None
        except ValueError:
            amount = None
        out.append({
            "_source_row": i,
            "transaction_id": row.get("transaction_id", ""),
            "source_account_id": row.get("source_account_id", ""),
            "source_name": row.get("source_name", ""),
            "destination_account_id": row.get("destination_account_id", ""),
            "destination_name": row.get("destination_name", ""),
            "amount_usd": amount,
            "txn_type": row.get("txn_type", ""),
            "merchant_or_bank": row.get("merchant_or_bank", ""),
            "txn_ts": row.get("txn_ts", ""),
            "reference": row.get("reference", ""),
        })
    schema = [
        {"field": "_source_row", "type": "integer"},
        {"field": "transaction_id", "type": "string"},
        {"field": "source_account_id", "type": "string"},
        {"field": "source_name", "type": "string"},
        {"field": "destination_account_id", "type": "string"},
        {"field": "destination_name", "type": "string"},
        {"field": "amount_usd", "type": "float"},
        {"field": "txn_type", "type": "string"},
        {"field": "merchant_or_bank", "type": "string"},
        {"field": "txn_ts", "type": "date"},
        {"field": "reference", "type": "string"},
    ]
    return Dataset(
        name="norm_bank_transactions",
        rows=out,
        source_file="synthetic_data/starter/bank_transactions.csv",
        schema=schema,
    )


def normalize_mobile_pings(path: Path) -> Dataset:
    """mobile_location_pings.jsonl → cleaned rows with numeric lat/lon."""
    rows = read_jsonl_raw(path)
    out: List[Dict[str, Any]] = []
    for i, row in enumerate(rows):
        out.append({
            "_source_row": i,
            "ping_id": str(row.get("ping_id", "")),
            "device_id": str(row.get("device_id", "")),
            "phone_number": str(row.get("phone_number", "")),
            "observed_name": str(row.get("observed_name", "")),
            "timestamp": str(row.get("timestamp", "")),
            "location_label": str(row.get("location_label", "")),
            "location_type": str(row.get("location_type", "")),
            "city": str(row.get("city", "")),
            "country": str(row.get("country", "")),
            "lat": row.get("lat"),
            "lon": row.get("lon"),
            "cell_tower": str(row.get("cell_tower", "")),
            "source": str(row.get("source", "")),
        })
    schema = [
        {"field": "_source_row", "type": "integer"},
        {"field": "ping_id", "type": "string"},
        {"field": "device_id", "type": "string"},
        {"field": "phone_number", "type": "string"},
        {"field": "observed_name", "type": "string"},
        {"field": "timestamp", "type": "date"},
        {"field": "location_label", "type": "string"},
        {"field": "location_type", "type": "string"},
        {"field": "city", "type": "string"},
        {"field": "country", "type": "string"},
        {"field": "lat", "type": "float"},
        {"field": "lon", "type": "float"},
        {"field": "cell_tower", "type": "string"},
        {"field": "source", "type": "string"},
    ]
    return Dataset(
        name="norm_mobile_pings",
        rows=out,
        source_file="synthetic_data/starter/mobile_location_pings.jsonl",
        schema=schema,
    )


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def run(dataset_dir: Path) -> Tuple[Dataset, Dataset, Dataset, Dataset, Dataset]:
    """Normalize all five sources under *dataset_dir*.

    Returns
    -------
    (norm_watchlist, norm_company_registry, norm_flight_manifests,
     norm_bank_transactions, norm_mobile_pings)
    """
    wl = normalize_watchlist(dataset_dir / "watchlist.csv")
    cr = normalize_company_registry(dataset_dir / "company_registry.csv")
    fm = normalize_flight_manifests(dataset_dir / "flight_manifests.csv")
    bt = normalize_bank_transactions(dataset_dir / "bank_transactions.csv")
    mp = normalize_mobile_pings(dataset_dir / "mobile_location_pings.jsonl")

    # Fix up source_file to be dataset-agnostic (relative path)
    rel = str(dataset_dir)
    for ds, filename in [
        (wl, "watchlist.csv"),
        (cr, "company_registry.csv"),
        (fm, "flight_manifests.csv"),
        (bt, "bank_transactions.csv"),
        (mp, "mobile_location_pings.jsonl"),
    ]:
        ds.source_file = str(dataset_dir / filename)

    return wl, cr, fm, bt, mp


if __name__ == "__main__":
    dataset_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic_data/starter")
    datasets = run(dataset_dir)
    for ds in datasets:
        print(f"{ds.name}: {len(ds)} rows")
