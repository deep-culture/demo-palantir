"""
pipeline/06_build_leads.py — Build address-confidence leads (F8, PHASE3_CONTRACT.md §1).

One lead per Person with at least one address source.  The scorer lives in
``pipeline/leads.py`` (shared with the Investigate seed builder, so both apps
show the same leads); this step wraps it as a Transform with row- and
field-level lineage, like steps 02–05.

Inputs
  resolved_persons            — who each source record belongs to (the shared resolver)
  norm_clinic_registrations   — PII + HEALTH, weight 0.5, home_address, registered_on
  norm_mobile_pings           — TELECOM, weight 0.4, location label, latest ping timestamp
  norm_company_registry       — OPEN,    weight 0.3, registered_address, incorporation_date

    score = 100 · min(1, Σ weight_i · exp(−ageDays_i / 365))

``ageDays`` counts from ``asOf``, the latest date in the inputs.  The best
address is the component with the largest contribution.  The output inherits
the union of its inputs' markings (PII, HEALTH, TELECOM and OPEN from the sources,
PII and LE-SENSITIVE through resolved_persons), so the dataset is HEALTH-marked
even for leads with no clinic component: markings work per dataset, not per row.

Output Dataset ``leads``:
  id             — lead::<personId>
  personId
  address        — best address (largest contribution)
  lat, lon       — coordinates of the best address
  score          — 0–100, 1 decimal
  status         — "open" (the Close lead Action changes it in the browser)
  components     — [{source, marking, weight, ageDays, decay, contribution, address, ...}]
  formula, asOf
  addressSource  — dataset of the best address's component
  sourceMarkings — markings of the contributing sources
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline.leads import compute_leads
from pipeline.lib import Dataset, LineageRecord, Transform

TRANSFORM_ID = "build_leads"
OUTPUT_NAME = "leads"

SCHEMA = [
    {"field": "id", "type": "string"},
    {"field": "personId", "type": "string"},
    {"field": "address", "type": "string"},
    {"field": "lat", "type": "float"},
    {"field": "lon", "type": "float"},
    {"field": "score", "type": "float"},
    {"field": "status", "type": "string"},
    {"field": "components", "type": "json"},
    {"field": "formula", "type": "string"},
    {"field": "asOf", "type": "date"},
    {"field": "addressSource", "type": "string"},
    {"field": "sourceMarkings", "type": "json"},
]


def _build(
    resolved_persons: Dataset,
    norm_clinic_registrations: Dataset,
    norm_mobile_pings: Dataset,
    norm_company_registry: Dataset,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, List[Dict[str, Any]]]]]:
    resolver = resolved_persons.resolver  # type: ignore[attr-defined]
    rows, provenance, _as_of = compute_leads(
        resolver, norm_clinic_registrations.rows, norm_mobile_pings.rows, norm_company_registry.rows,
    )
    person_row = {row["id"]: i for i, row in enumerate(resolved_persons.rows)}
    for lead, fp in zip(rows, provenance):
        ref = {"dataset": resolved_persons.name, "row": person_row.get(lead["personId"], -1),
               "field": "id", "note": "person"}
        fp["personId"] = [ref] + fp["personId"]
        fp["id"] = [ref]
    return rows, provenance


def run(
    resolved_persons: Dataset,
    norm_clinic_registrations: Dataset,
    norm_mobile_pings: Dataset,
    norm_company_registry: Dataset,
) -> Tuple[Dataset, LineageRecord]:
    transform = Transform(
        TRANSFORM_ID,
        "Score each person's best address from clinic, ping and registry records.",
        [resolved_persons, norm_clinic_registrations, norm_mobile_pings, norm_company_registry],
        _build,
    )
    leads_ds, lineage = transform.run()
    leads_ds.name = OUTPUT_NAME
    leads_ds.schema = [dict(f) for f in SCHEMA]
    leads_ds.as_of = leads_ds.rows[0]["asOf"] if leads_ds.rows else ""  # type: ignore[attr-defined]
    return leads_ds, lineage


if __name__ == "__main__":
    import importlib.util

    def _load(stem: str):
        path = Path(__file__).resolve().parent / f"{stem}.py"
        spec = importlib.util.spec_from_file_location(stem, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    dataset_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("synthetic_data/starter")
    wl, cr, fm, bt, mp, cl = _load("01_normalize_sources").run(dataset_dir)
    persons, _ = _load("02_resolve_persons").run(wl, cr, fm, mp, cl)
    leads_ds, _ = run(persons, cl, mp, cr)
    print(f"Leads: {len(leads_ds)} (asOf {leads_ds.as_of})")
    for lead in leads_ds.rows[:5]:
        print(f"  {lead['score']:5.1f}  {lead['personId']}  {lead['address']}")
