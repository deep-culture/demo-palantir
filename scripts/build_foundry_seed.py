#!/usr/bin/env python3
"""
scripts/build_foundry_seed.py — Orchestrate the Foundry Studio pipeline and
write foundry-demo/seed.js.

Usage
-----
    python3 scripts/build_foundry_seed.py [--output foundry-demo/seed.js]

The script runs the full five-step pipeline for both 'starter' and 'simulator'
datasets and collects:
  - Pipeline DAG descriptor (transforms with embedded source code)
  - Dataset snapshots (schema, sample rows, row counts, lineage links)
  - Entity-level lineage map
  - Final ontology entities and edges (same shape as the Gotham demo)
  - Governance block (markings, roles, purposes, checkpoints, honesty) from
    pipeline/governance.py, identical to the Gotham seed's
  - Per dataset: markings, markingProvenance, purpose, legalBasis,
    retentionDays, inputPurposes and derivedFrom (union rule, contract §4)
  - Phase 2: ``ontology`` (``actionTypes``, ``externalSystems`` from
    pipeline/actions.py) and ``resolution`` (candidate pairs from
    pipeline/candidates.py), identical to the Gotham seed's

Output
------
    window.foundrySeedCatalog = { starter: {...}, simulator: {...} };
    window.foundrySeed = window.foundrySeedCatalog["starter"];
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Ensure repo root is on sys.path so 'pipeline' package imports work
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from pipeline import actions, candidates, governance
from pipeline.lib import Dataset, LineageRecord
from pipeline.seedmeta import build_metadata

# Pipeline module files are named with leading digits (01_, 02_, ...) which
# Python cannot import via the normal 'import' statement.  Use importlib.
import importlib.util as _ilu


def _load_pipeline_module(stem: str, alias: str):
    path = REPO_ROOT / "pipeline" / f"{stem}.py"
    spec = _ilu.spec_from_file_location(alias, path)
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


step01 = _load_pipeline_module("01_normalize_sources", "step01")
step02 = _load_pipeline_module("02_resolve_persons", "step02")
step03 = _load_pipeline_module("03_resolve_companies", "step03")
step04 = _load_pipeline_module("04_resolve_accounts", "step04")
step05 = _load_pipeline_module("05_build_ontology", "step05")


# ---------------------------------------------------------------------------
# Code loader
# ---------------------------------------------------------------------------

PIPELINE_CODE_PATHS = {
    "normalize_sources": "pipeline/01_normalize_sources.py",
    "resolve_persons": "pipeline/02_resolve_persons.py",
    "resolve_companies": "pipeline/03_resolve_companies.py",
    "resolve_accounts": "pipeline/04_resolve_accounts.py",
    "build_ontology": "pipeline/05_build_ontology.py",
}


def _load_code(rel_path: str) -> str:
    full_path = REPO_ROOT / rel_path
    if full_path.exists():
        return full_path.read_text(encoding="utf-8")
    return f"# Source not found: {rel_path}"


# ---------------------------------------------------------------------------
# Dataset serialiser
# ---------------------------------------------------------------------------

SAMPLE_ROWS = 20
PAGE_ROWS = 10


def _serialise_dataset(
    ds: Dataset,
    produced_by: str = "",
    consumed_by: Optional[List[str]] = None,
    dataset_id: Optional[str] = None,
    raw: bool = False,
) -> Dict[str, Any]:
    did = dataset_id or ds.name
    rows_sample = ds.rows[:SAMPLE_ROWS]
    # JSON-safe: replace any non-serialisable values
    safe_rows = []
    for row in rows_sample:
        safe_row = {}
        for k, v in row.items():
            if isinstance(v, (str, int, float, bool, type(None), list, dict)):
                safe_row[k] = v
            else:
                safe_row[k] = str(v)
        safe_rows.append(safe_row)

    return {
        "id": did,
        "name": did if raw else ds.name,
        "sourceFile": ds.source_file or "",
        "schema": ds.schema,
        "rowCount": len(ds.rows),
        "sampleRows": safe_rows,
        "producedBy": produced_by,
        "consumedBy": consumed_by or [],
        # Raw datasets have no inputs; everything else lists the dataset ids it
        # was computed from, so the union rule can be checked (and overrides
        # recomputed) from the seed alone.
        "derivedFrom": [] if raw else list(ds.derived_from),
        **ds.governance(),
        **({"asOf": getattr(ds, "as_of", "")} if raw or produced_by == "normalize_sources" else {}),
    }


# ---------------------------------------------------------------------------
# Lineage serialiser
# ---------------------------------------------------------------------------

def _build_entity_lineage(
    entities_ds: Dataset,
    entity_lineage: LineageRecord,
    person_lineage: LineageRecord,
    company_lineage: LineageRecord,
    account_lineage: LineageRecord,
    resolved_persons: Dataset,
    resolved_companies: Dataset,
    resolved_accounts: Dataset,
) -> Dict[str, Any]:
    """Build the lineage dict keyed by entity ID."""

    lineage_map: Dict[str, Any] = {}

    # Helper to merge LineageRecord entries for a given entity_id
    def _from_lineage(eid: str, ds: Dataset, lr: LineageRecord) -> Optional[Dict[str, Any]]:
        for out_idx, row in enumerate(ds.rows):
            if row.get("id") == eid:
                sources = lr.sources.get(out_idx, [])
                fp = lr.field_provenance.get(out_idx, {})
                return {
                    "producedBy": ds.name,
                    "sourceRows": sources,
                    "fieldProvenance": fp,
                }
        return None

    for entity in entities_ds.rows:
        eid = entity["id"]
        etype = entity["type"]

        result: Optional[Dict[str, Any]] = None
        if etype == "Person":
            result = _from_lineage(eid, resolved_persons, person_lineage)
        elif etype == "Company":
            result = _from_lineage(eid, resolved_companies, company_lineage)
        elif etype == "BankAccount":
            result = _from_lineage(eid, resolved_accounts, account_lineage)

        if result is None:
            # Entities produced directly in step05 (Device, Flight, Airport, Location, WatchlistRecord)
            result = {
                "producedBy": "build_ontology",
                "sourceRows": [],
                "fieldProvenance": {},
            }

        lineage_map[eid] = result

    return lineage_map


# ---------------------------------------------------------------------------
# Pipeline runner
# ---------------------------------------------------------------------------

def build_catalog_entry(
    dataset_key: str,
    dataset_dir: Path,
    generated_at: str,
    codes: Dict[str, str],
) -> Dict[str, Any]:
    # Step 01: Normalize sources (markings etc. from manifest.json)
    wl, cr, fm, bt, mp, cl = step01.run(dataset_dir)

    # Step 02: Resolve persons (clinic rows attach by name + dob only)
    persons_ds, person_lineage = step02.run(wl, cr, fm, mp, cl)

    # Step 03: Resolve companies
    companies_ds, company_lineage = step03.run(cr)

    # Step 04: Resolve accounts
    accounts_ds, account_lineage = step04.run(bt)

    # Step 05: Build ontology
    entities_ds, edges_ds, entity_lineage_raw, edge_lineage = step05.run(
        persons_ds, companies_ds, accounts_ds, wl, cr, fm, bt, mp, cl
    )

    # --- Pipeline DAG ---
    transforms = [
        {
            "id": "normalize_sources",
            "name": "01 Normalize Sources",
            "description": "Read all six raw source files; strip whitespace, parse dates, split pipe-delimited aliases, and copy each file's markings and purpose from manifest.json. Produces one clean Dataset per source, each marked like its raw file.",
            "inputs": ["watchlist.csv", "company_registry.csv", "flight_manifests.csv",
                       "bank_transactions.csv", "mobile_location_pings.jsonl", "clinic_registrations.csv"],
            "output": "norm_sources",
            "codePath": PIPELINE_CODE_PATHS["normalize_sources"],
            "code": codes["normalize_sources"],
            "rowsIn": 0,   # raw files — row count computed below
            "rowsOut": len(wl) + len(cr) + len(fm) + len(bt) + len(mp) + len(cl),
            "builtAt": generated_at,
        },
        {
            "id": "resolve_persons",
            "name": "02 Resolve Persons",
            "description": "Entity-resolve persons across watchlist, registry, flights and pings by passport_id > phone_number > name+dob > alias, then attach clinic registrations by name + dob only (a clinic row never creates a person). A name alone never extends or re-points a watchlisted identity. Records full field-level provenance; candidate pairs for the Resolution tab are scored afterwards (pipeline/candidates.py).",
            "inputs": ["norm_watchlist", "norm_company_registry", "norm_flight_manifests",
                       "norm_mobile_pings", "norm_clinic_registrations"],
            "output": "resolved_persons",
            "codePath": PIPELINE_CODE_PATHS["resolve_persons"],
            "code": codes["resolve_persons"],
            "rowsIn": len(wl) + len(cr) + len(fm) + len(mp) + len(cl),
            "rowsOut": len(persons_ds),
            "builtAt": generated_at,
        },
        {
            "id": "resolve_companies",
            "name": "03 Resolve Companies",
            "description": "Deduplicate company_registry rows by company_id and emit canonical Company entities.",
            "inputs": ["norm_company_registry"],
            "output": "resolved_companies",
            "codePath": PIPELINE_CODE_PATHS["resolve_companies"],
            "code": codes["resolve_companies"],
            "rowsIn": len(cr),
            "rowsOut": len(companies_ds),
            "builtAt": generated_at,
        },
        {
            "id": "resolve_accounts",
            "name": "04 Resolve Accounts",
            "description": "Extract all unique account IDs from both sides of bank_transactions and emit BankAccount entities.",
            "inputs": ["norm_bank_transactions"],
            "output": "resolved_accounts",
            "codePath": PIPELINE_CODE_PATHS["resolve_accounts"],
            "code": codes["resolve_accounts"],
            "rowsIn": len(bt),
            "rowsOut": len(accounts_ds),
            "builtAt": generated_at,
        },
        {
            "id": "build_ontology",
            "name": "05 Build Ontology",
            "description": "Combine all resolved entities with Device, Flight, Airport, Location, and WatchlistRecord types (including residential Locations from clinic rows). Emit all relationship edges, and mark every object and link.",
            "inputs": ["resolved_persons", "resolved_companies", "resolved_accounts",
                       "norm_watchlist", "norm_company_registry", "norm_flight_manifests",
                       "norm_bank_transactions", "norm_mobile_pings", "norm_clinic_registrations"],
            "output": "ontology",
            "codePath": PIPELINE_CODE_PATHS["build_ontology"],
            "code": codes["build_ontology"],
            "rowsIn": len(persons_ds) + len(companies_ds) + len(accounts_ds) + len(wl) + len(cr) + len(fm) + len(bt) + len(mp) + len(cl),
            "rowsOut": len(entities_ds) + len(edges_ds),
            "builtAt": generated_at,
        },
    ]

    # Fix rowsIn for normalize_sources
    transforms[0]["rowsIn"] = 0  # raw source files — counts shown in dataset entries

    # --- Dataset snapshots ---
    raw_datasets = [
        _serialise_dataset(ds, produced_by="", consumed_by=["normalize_sources"],
                           dataset_id=ds.derived_from[0], raw=True)
        for ds in (wl, cr, fm, bt, mp, cl)
    ]
    # Raw datasets show the repo-relative source path set by step 01.

    norm_datasets = [
        _serialise_dataset(wl, produced_by="normalize_sources", consumed_by=["resolve_persons", "build_ontology"]),
        _serialise_dataset(cr, produced_by="normalize_sources", consumed_by=["resolve_persons", "resolve_companies", "build_ontology"]),
        _serialise_dataset(fm, produced_by="normalize_sources", consumed_by=["resolve_persons", "build_ontology"]),
        _serialise_dataset(bt, produced_by="normalize_sources", consumed_by=["resolve_accounts", "build_ontology"]),
        _serialise_dataset(mp, produced_by="normalize_sources", consumed_by=["resolve_persons", "build_ontology"]),
        _serialise_dataset(cl, produced_by="normalize_sources", consumed_by=["resolve_persons", "build_ontology"]),
    ]

    resolved_datasets = [
        _serialise_dataset(persons_ds, produced_by="resolve_persons", consumed_by=["build_ontology"]),
        _serialise_dataset(companies_ds, produced_by="resolve_companies", consumed_by=["build_ontology"]),
        _serialise_dataset(accounts_ds, produced_by="resolve_accounts", consumed_by=["build_ontology"]),
    ]

    final_datasets = [
        _serialise_dataset(entities_ds, produced_by="build_ontology", consumed_by=[]),
        _serialise_dataset(edges_ds, produced_by="build_ontology", consumed_by=[]),
    ]

    all_datasets = raw_datasets + norm_datasets + resolved_datasets + final_datasets

    # --- Entity lineage map ---
    lineage_map = _build_entity_lineage(
        entities_ds, entity_lineage_raw,
        person_lineage, company_lineage, account_lineage,
        persons_ds, companies_ds, accounts_ds,
    )

    metadata = {
        **build_metadata(dataset_dir, Path(__file__)),
        "title": "Foundry Studio Demo",
        "dataset": dataset_key,
        "generatedAt": generated_at,
    }

    resolution = candidates.resolution_block(dataset_key, persons_ds.resolver, wl.rows, cr.rows, fm.rows, mp.rows)

    return {
        "metadata": metadata,
        "governance": governance.governance_block(),
        "ontology": actions.ontology_block(),
        "resolution": resolution,
        "pipeline": {
            "generatedAt": generated_at,
            "transforms": transforms,
        },
        "datasets": all_datasets,
        "lineage": lineage_map,
        "entities": [
            {k: v for k, v in e.items()} for e in entities_ds.rows
        ],
        "edges": [
            {k: v for k, v in e.items()} for e in edges_ds.rows
        ],
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Foundry Studio seed for the demo app.")
    parser.add_argument("--output", default="foundry-demo/seed.js", help="Output path (relative to repo root).")
    parser.add_argument(
        "--dataset", action="append",
        help="Dataset in key=path form.  Defaults to starter and simulator.",
    )
    args = parser.parse_args()

    output_path = (REPO_ROOT / args.output).resolve()
    dataset_defs: List[Tuple[str, str]] = []
    raw_defs = args.dataset or [
        "starter=synthetic_data/starter",
        "simulator=synthetic_data/simulator",
    ]
    for d in raw_defs:
        if "=" in d:
            key, path = d.split("=", 1)
        else:
            path = d
            key = Path(d).name
        dataset_defs.append((key.strip(), path.strip()))

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    # Load pipeline source code once
    codes = {name: _load_code(path) for name, path in PIPELINE_CODE_PATHS.items()}

    catalog: Dict[str, Any] = {}
    for dataset_key, dataset_path in dataset_defs:
        dataset_dir = (REPO_ROOT / dataset_path).resolve()
        print(f"Building {dataset_key} from {dataset_dir} …")
        catalog[dataset_key] = build_catalog_entry(dataset_key, dataset_dir, generated_at, codes)
        entry = catalog[dataset_key]
        print(
            f"  {len(entry['entities'])} entities, {len(entry['edges'])} edges, "
            f"{len(entry['datasets'])} datasets"
        )

    default_key = "starter" if "starter" in catalog else next(iter(catalog))
    payload = "window.foundrySeedCatalog = " + json.dumps(catalog, indent=2, ensure_ascii=False) + ";\n"
    payload += f"window.foundrySeed = window.foundrySeedCatalog[{json.dumps(default_key)}];\n"

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(payload, encoding="utf-8")
    print(f"\nWrote foundry seed to {output_path}")


if __name__ == "__main__":
    main()
