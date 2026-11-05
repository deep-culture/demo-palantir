"""
pipeline/lib.py — Core abstractions for the Foundry Studio pipeline.

Provides Dataset, LineageRecord, and Transform so that each pipeline
step can be written as a pure function and still carry full row-level
and field-level provenance.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from pipeline import governance


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def slug(value: str) -> str:
    """Lowercase, replace non-alphanumeric runs with hyphens, strip edges.

    Identical to the slug() function in scripts/build_ontology_seed.py so
    that entity IDs produced by this pipeline match the Gotham demo exactly.
    """
    token = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return token or "unknown"


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------

class Dataset:
    """An in-memory table produced or consumed by a pipeline Transform.

    Attributes
    ----------
    name : str
        Human-readable dataset name used in UI labels and lineage keys.
    rows : list[dict]
        Each dict is one record.  Keys are field names; values are typed
        Python objects (str, int, float, list, dict, or None).
    source_file : str | None
        Relative path to the raw source file, set only for raw datasets.
    schema : list[dict]
        List of ``{"field": str, "type": str}`` descriptors.
        Recognised types: "string", "date", "float", "integer", "json".
    produced_by : str
        ID of the Transform that created this Dataset (empty for raw inputs).
    consumed_by : list[str]
        IDs of Transforms that use this Dataset as an input.
    markings : list[str]
        Dataset markings (PHASE1_CONTRACT.md §4).  Raw datasets copy them from
        ``manifest.json``; derived datasets get the union of their inputs.
    marking_provenance : dict[str, list[str]]
        ``{marking: [raw dataset ids]}`` — where each marking came from.
    purpose, legal_basis, retention_days, input_purposes
        Purpose and legal-basis tags (manifest for raw data; see
        ``governance.derived_governance`` for derived data).
    derived_from : list[str]
        IDs of the datasets this one was computed from (empty for raw data).
    """

    def __init__(
        self,
        name: str,
        rows: List[Dict[str, Any]],
        source_file: Optional[str] = None,
        schema: Optional[List[Dict[str, str]]] = None,
    ) -> None:
        self.name = name
        self.rows = rows
        self.source_file = source_file
        self.schema: List[Dict[str, str]] = schema or []
        self.produced_by: str = ""
        self.consumed_by: List[str] = []
        self.markings: List[str] = []
        self.marking_provenance: Dict[str, List[str]] = {}
        self.purpose: str = ""
        self.legal_basis: str = ""
        self.retention_days: Optional[int] = None
        self.input_purposes: List[str] = []
        self.derived_from: List[str] = []
        # Optional field-level markings from the manifest (raw and normalised
        # datasets only; e.g. the company register's beneficial-owner columns).
        self.field_markings: Dict[str, List[str]] = {}
        self.field_note: str = ""

    # Governance helpers
    def governance(self) -> Dict[str, Any]:
        """Governance fields in the seed's camelCase shape."""
        return {
            "markings": list(self.markings),
            "markingProvenance": {k: list(v) for k, v in self.marking_provenance.items()},
            "purpose": self.purpose,
            "legalBasis": self.legal_basis,
            "retentionDays": self.retention_days,
            "inputPurposes": list(self.input_purposes),
            **({"fieldMarkings": {k: list(v) for k, v in self.field_markings.items()},
                "fieldNote": self.field_note} if self.field_markings else {}),
        }

    def set_governance(self, fields: Dict[str, Any]) -> None:
        self.markings = list(fields.get("markings", []))
        self.marking_provenance = {k: list(v) for k, v in fields.get("markingProvenance", {}).items()}
        self.purpose = fields.get("purpose", "")
        self.legal_basis = fields.get("legalBasis", "")
        self.retention_days = fields.get("retentionDays")
        self.input_purposes = list(fields.get("inputPurposes", []))
        self.field_markings = {k: list(v) for k, v in (fields.get("fieldMarkings") or {}).items()}
        self.field_note = fields.get("fieldNote", "")

    # Convenience helpers
    def __len__(self) -> int:
        return len(self.rows)

    def __repr__(self) -> str:
        return f"Dataset(name={self.name!r}, rows={len(self.rows)})"


def inherit_markings(output: Dataset, inputs: Sequence[Dataset]) -> Dataset:
    """Apply the union rule: ``output`` inherits every marking of ``inputs``.

    ``output.markings = union(input.markings)`` and
    ``output.marking_provenance`` records, per marking, the raw datasets it
    came from (provenance is passed through, so it always names raw data).
    Used by :meth:`Transform.run` and by the pipeline steps, which build their
    output datasets directly.
    """
    output.set_governance(governance.derived_governance([ds.governance() for ds in inputs]))
    output.derived_from = [ds.name for ds in inputs]
    return output


# ---------------------------------------------------------------------------
# LineageRecord
# ---------------------------------------------------------------------------

class LineageRecord:
    """Tracks row-level and field-level provenance for a single output Dataset.

    ``sources[output_row_index]`` → list of source-reference dicts:
        ``{"dataset": str, "row": int, "field": str, "note": str}``

    ``field_provenance[output_row_index]`` → dict mapping each output field
        name to a list of the same source-reference dicts that supplied it.
    """

    def __init__(self) -> None:
        # output_row_index → list of {dataset, row, field, note}
        self.sources: Dict[int, List[Dict[str, Any]]] = {}
        # output_row_index → {output_field → list of {dataset, row, field, note}}
        self.field_provenance: Dict[int, Dict[str, List[Dict[str, Any]]]] = {}

    def add_source(
        self,
        output_row: int,
        dataset: str,
        row: int,
        field: str = "",
        note: str = "",
    ) -> None:
        """Record that a source row contributed to an output row."""
        ref = {"dataset": dataset, "row": row, "field": field, "note": note}
        self.sources.setdefault(output_row, []).append(ref)

    def add_field_source(
        self,
        output_row: int,
        output_field: str,
        dataset: str,
        row: int,
        source_field: str = "",
        note: str = "",
    ) -> None:
        """Record that a specific source cell supplied an output field value."""
        ref = {"dataset": dataset, "row": row, "field": source_field, "note": note}
        self.field_provenance.setdefault(output_row, {}).setdefault(output_field, []).append(ref)

    def to_dict(self) -> Dict[str, Any]:
        """Serialise to a plain dict for JSON embedding."""
        return {
            "sources": {str(k): v for k, v in self.sources.items()},
            "fieldProvenance": {
                str(k): fp for k, fp in self.field_provenance.items()
            },
        }


# ---------------------------------------------------------------------------
# Transform
# ---------------------------------------------------------------------------

class Transform:
    """A named, documented pipeline step.

    Parameters
    ----------
    name : str
        Short name for the transform (used as its ID in the DAG).
    description : str
        One-sentence explanation of what this step does.
    inputs : list[Dataset]
        Ordered list of input datasets.
    fn : callable
        Receives ``*input_datasets`` and returns
        ``(output_rows, field_provenance_per_row)`` where:

        * ``output_rows`` is a ``list[dict]``
        * ``field_provenance_per_row`` is a ``list[dict]`` of the same
          length, mapping ``output_field → list[{dataset, row, field, note}]``
    """

    def __init__(
        self,
        name: str,
        description: str,
        inputs: List[Dataset],
        fn: Callable[..., Tuple[List[Dict[str, Any]], List[Dict[str, List[Dict[str, Any]]]]]],
    ) -> None:
        self.name = name
        self.description = description
        self.inputs = inputs
        self.fn = fn
        self.code: str = ""          # populated by build_foundry_seed.py
        self.code_path: str = ""     # relative path to the source file

    def run(self) -> Tuple[Dataset, LineageRecord]:
        """Execute the transform function and wrap results in Dataset + LineageRecord."""
        output_rows, field_provenance_per_row = self.fn(*self.inputs)

        # Determine output schema from first row keys if rows were produced
        schema: List[Dict[str, str]] = []
        if output_rows:
            for key in output_rows[0].keys():
                schema.append({"field": key, "type": "string"})

        output_dataset = Dataset(
            name=self.name,
            rows=output_rows,
            schema=schema,
        )
        output_dataset.produced_by = self.name
        # Markings carry down lineage: union of the inputs (contract §4).
        inherit_markings(output_dataset, self.inputs)

        # Register consumed_by back-references
        for ds in self.inputs:
            if self.name not in ds.consumed_by:
                ds.consumed_by.append(self.name)

        lineage = LineageRecord()
        for out_idx, fp in enumerate(field_provenance_per_row):
            # Collect row-level sources from all fields
            seen_row_refs: set = set()
            for output_field, refs in fp.items():
                lineage.field_provenance.setdefault(out_idx, {})[output_field] = refs
                for ref in refs:
                    key = (ref["dataset"], ref["row"])
                    if key not in seen_row_refs:
                        seen_row_refs.add(key)
                        lineage.add_source(out_idx, ref["dataset"], ref["row"], note=ref.get("note", ""))

        return output_dataset, lineage
