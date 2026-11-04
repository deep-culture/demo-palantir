"""
pipeline/04_resolve_accounts.py — Entity resolution for BankAccount entities.

Keyed by account_id from the normalized bank_transactions dataset.
Both source and destination accounts are extracted.

Output Dataset: bank account entities
  id           — bankaccount::{slug(account_id)}
  accountId
  ownerName
  accountKind  — "personal" | "corporate" | "" (resolved downstream in step 05)
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.lib import Dataset, LineageRecord, inherit_markings, slug


def _merge(a: str, b: str) -> str:
    if not b:
        return a
    if not a:
        return b
    return b if len(b) > len(a) else a


def run(norm_bank_transactions: Dataset) -> Tuple[Dataset, LineageRecord]:
    """Resolve BankAccount entities from the normalized bank_transactions dataset."""
    seen: Dict[str, int] = {}   # account_id → output_row_index
    output_rows: List[Dict[str, Any]] = []
    fp_per_row: List[Dict[str, List[Dict[str, Any]]]] = []
    ds_name = norm_bank_transactions.name

    def upsert(account_id: str, owner_name: str, src_row: int, id_field: str, name_field: str) -> None:
        if not account_id:
            return
        if account_id in seen:
            out_idx = seen[account_id]
            existing = output_rows[out_idx]
            fp = fp_per_row[out_idx]
            if owner_name and not existing.get("ownerName"):
                existing["ownerName"] = owner_name
                fp.setdefault("ownerName", []).append(
                    {"dataset": ds_name, "row": src_row, "field": name_field, "note": "merge"}
                )
        else:
            out_idx = len(output_rows)
            seen[account_id] = out_idx
            entity_id = f"bankaccount::{slug(account_id)}"
            out_row: Dict[str, Any] = {
                "id": entity_id,
                "type": "BankAccount",
                "accountId": account_id,
                "ownerName": owner_name,
                "accountKind": "",
            }
            fp_entry: Dict[str, List[Dict[str, Any]]] = {
                "id": [{"dataset": ds_name, "row": src_row, "field": id_field, "note": "key"}],
                "accountId": [{"dataset": ds_name, "row": src_row, "field": id_field, "note": ""}],
            }
            if owner_name:
                fp_entry["ownerName"] = [{"dataset": ds_name, "row": src_row, "field": name_field, "note": ""}]
            output_rows.append(out_row)
            fp_per_row.append(fp_entry)

    for row in norm_bank_transactions.rows:
        src_row = int(row["_source_row"])
        upsert(
            row.get("source_account_id", ""),
            row.get("source_name", ""),
            src_row,
            "source_account_id",
            "source_name",
        )
        upsert(
            row.get("destination_account_id", ""),
            row.get("destination_name", ""),
            src_row,
            "destination_account_id",
            "destination_name",
        )

    schema = [
        {"field": "id", "type": "string"},
        {"field": "type", "type": "string"},
        {"field": "accountId", "type": "string"},
        {"field": "ownerName", "type": "string"},
        {"field": "accountKind", "type": "string"},
    ]

    ds = Dataset(name="resolved_accounts", rows=output_rows, schema=schema)
    inherit_markings(ds, [norm_bank_transactions])
    lineage = LineageRecord()

    for out_idx, fp in enumerate(fp_per_row):
        src_refs = fp.get("id", [])
        for ref in src_refs:
            lineage.add_source(out_idx, ref["dataset"], ref["row"], note="account")
        for output_field, refs in fp.items():
            lineage.field_provenance.setdefault(out_idx, {})[output_field] = refs

    return ds, lineage


if __name__ == "__main__":
    from pipeline.p01_normalize_sources import run as norm_run
    dataset_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic_data/starter")
    _, _, _, bt, _, _ = norm_run(dataset_dir)
    ds, lineage = run(bt)
    print(f"Resolved {len(ds)} bank accounts")
    for row in ds.rows[:5]:
        print(" ", row["id"], "—", row["ownerName"])
