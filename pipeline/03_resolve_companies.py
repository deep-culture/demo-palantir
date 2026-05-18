"""
pipeline/03_resolve_companies.py — Entity resolution for Company entities.

Keyed by company_id from the normalized company_registry dataset.

Output Dataset: company entities
  id                 — company::{slug(company_id)}
  companyName
  jurisdiction
  incorporationDate
  registeredAddress
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.lib import Dataset, LineageRecord, slug


def run(norm_company_registry: Dataset) -> Tuple[Dataset, LineageRecord]:
    """Resolve Company entities from the normalized company_registry dataset."""
    seen: Dict[str, int] = {}   # company_id → output_row_index
    output_rows: List[Dict[str, Any]] = []
    fp_per_row: List[Dict[str, List[Dict[str, Any]]]] = []

    for row in norm_company_registry.rows:
        company_id = row.get("company_id", "")
        if not company_id:
            continue

        src_row = int(row["_source_row"])
        ds_name = norm_company_registry.name

        if company_id in seen:
            # Merge into existing — update any empty fields
            out_idx = seen[company_id]
            existing = output_rows[out_idx]
            fp = fp_per_row[out_idx]
            for out_field, src_field in [
                ("companyName", "company_name"),
                ("jurisdiction", "jurisdiction"),
                ("incorporationDate", "incorporation_date"),
                ("registeredAddress", "registered_address"),
            ]:
                val = row.get(src_field, "")
                if val and not existing.get(out_field):
                    existing[out_field] = val
                    fp.setdefault(out_field, []).append(
                        {"dataset": ds_name, "row": src_row, "field": src_field, "note": "merge"}
                    )
        else:
            out_idx = len(output_rows)
            seen[company_id] = out_idx
            entity_id = f"company::{slug(company_id)}"
            out_row: Dict[str, Any] = {
                "id": entity_id,
                "type": "Company",
                "companyName": row.get("company_name", ""),
                "jurisdiction": row.get("jurisdiction", ""),
                "incorporationDate": row.get("incorporation_date", ""),
                "registeredAddress": row.get("registered_address", ""),
            }
            fp: Dict[str, List[Dict[str, Any]]] = {}
            for out_field, src_field in [
                ("companyName", "company_name"),
                ("jurisdiction", "jurisdiction"),
                ("incorporationDate", "incorporation_date"),
                ("registeredAddress", "registered_address"),
            ]:
                if row.get(src_field):
                    fp[out_field] = [{"dataset": ds_name, "row": src_row, "field": src_field, "note": ""}]
            fp["id"] = [{"dataset": ds_name, "row": src_row, "field": "company_id", "note": "key"}]
            output_rows.append(out_row)
            fp_per_row.append(fp)

    schema = [
        {"field": "id", "type": "string"},
        {"field": "type", "type": "string"},
        {"field": "companyName", "type": "string"},
        {"field": "jurisdiction", "type": "string"},
        {"field": "incorporationDate", "type": "date"},
        {"field": "registeredAddress", "type": "string"},
    ]

    ds = Dataset(name="resolved_companies", rows=output_rows, schema=schema)
    lineage = LineageRecord()

    for out_idx, (out_row, fp) in enumerate(zip(output_rows, fp_per_row)):
        # Row-level: find the original source row index
        src_refs = fp.get("id", fp.get("companyName", []))
        for ref in src_refs:
            lineage.add_source(out_idx, ref["dataset"], ref["row"], note="company")
        # Field-level provenance
        for output_field, refs in fp.items():
            lineage.field_provenance.setdefault(out_idx, {})[output_field] = refs

    return ds, lineage


if __name__ == "__main__":
    from pipeline.p01_normalize_sources import run as norm_run
    dataset_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic_data/starter")
    _, cr, _, _, _ = norm_run(dataset_dir)
    ds, lineage = run(cr)
    print(f"Resolved {len(ds)} companies")
    for row in ds.rows[:5]:
        print(" ", row["id"], "—", row["companyName"])
