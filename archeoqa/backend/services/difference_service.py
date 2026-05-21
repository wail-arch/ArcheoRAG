"""Deterministic paper difference summaries over the local paper manifest.

Difference Finder V1 is a cheap planning workflow: it does not call PaperQA
retrieval, PaperQA query, embeddings, or an LLM. It compares already-derived
manifest/Matrix fields so researchers can decide whether a cited Compare run is
worth the cost.
"""

from __future__ import annotations

from typing import Any

from .paper_manifest_service import get_manifest_service
from .paper_resolver import normalize_text

COMPARISON_FIELDS = [
    "sites",
    "regions",
    "periods",
    "date_ranges",
    "method_tags",
    "evidence_types",
    "main_claims",
    "limitations",
    "uncertainties",
    "paper_kind",
]

STRONG_FIELDS = {
    "sites",
    "regions",
    "periods",
    "date_ranges",
    "method_tags",
    "evidence_types",
}

FIELD_LABELS = {
    "sites": "sites",
    "regions": "régions",
    "periods": "périodes",
    "date_ranges": "datations/périodes",
    "method_tags": "méthodes/données",
    "evidence_types": "types de preuve",
    "main_claims": "claims",
    "limitations": "limites",
    "uncertainties": "incertitudes",
    "paper_kind": "type de papier",
}

VALUE_LIMITS = {
    "sites": 12,
    "regions": 10,
    "periods": 12,
    "date_ranges": 10,
    "method_tags": 10,
    "evidence_types": 8,
    "main_claims": 5,
    "limitations": 5,
    "uncertainties": 5,
    "paper_kind": 3,
}

FOCUS_SKIP_VALUES = {
    "africa",
    "canary islands",
    "iberia",
    "late neolithic",
    "levant",
    "mtdna",
    "neolithic",
    "north africa",
    "upper palaeolithic",
    "upper paleolithic",
    "maghreb",
    "morocco",
    "radiocarbon",
    "lithics",
    "stratigraphy",
    "typology",
    "ceramic",
}

CENTRAL_GENETIC_METHODS = {"adna", "autosomal", "y dna", "y-dna"}

CONTEXTUAL_SHARED_VALUES = FOCUS_SKIP_VALUES | {
    "europe",
    "eastern mediterranean",
    "western mediterranean",
    "near east",
    "northwest africa",
    "southwest asia",
    "late pleistocene",
    "middle palaeolithic",
    "middle paleolithic",
    "middle stone age",
    "epipaleolithic",
    "epi palaeolithic",
    "epi-palaeolithic",
    "aterian",
    "ibero-maurusian",
    "iberomaurusian",
    "primary study",
    "primary_study",
    "preprint",
    "review",
}


def _as_values(row: dict[str, Any], field: str) -> list[str]:
    value = row.get(field)
    if field == "paper_kind":
        return [] if value in {None, "", "unknown"} else [str(value)]
    if not isinstance(value, list):
        return []
    output: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = str(item or "").strip()
        key = normalize_text(text)
        if text and key and key not in seen:
            seen.add(key)
            output.append(text)
    return output


def _values_by_key(values: list[str]) -> dict[str, str]:
    output: dict[str, str] = {}
    for value in values:
        key = normalize_text(value)
        if key and key not in output:
            output[key] = value
    return output


def _cap_values(field: str, values: list[str]) -> list[str]:
    return values[: VALUE_LIMITS.get(field, 8)]


def _paper_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "file_location": row.get("file_location"),
        "filename": row.get("filename"),
        "docname": row.get("docname"),
        "title": row.get("title"),
        "year": row.get("year"),
        "citation": row.get("citation"),
        "label": row.get("label"),
        "source": row.get("source") or "indexed_only",
        "matrix_status": row.get("matrix_status"),
        "row_verified": bool(row.get("row_verified")),
        "needs_review": bool(row.get("needs_review")),
    }


def _difference_note(row: dict[str, Any]) -> str:
    if row.get("source") == "indexed_only":
        return "non renseigné dans la Matrix"
    if row.get("needs_review"):
        return "documenté dans la Matrix, à vérifier"
    return "documenté dans la Matrix"


def _shared_values(rows: list[dict[str, Any]], field: str) -> list[str]:
    keyed_values = [_values_by_key(_as_values(row, field)) for row in rows]
    if any(not values for values in keyed_values):
        return []
    shared_keys = set(keyed_values[0])
    for values in keyed_values[1:]:
        shared_keys &= set(values)
    return _cap_values(field, sorted(keyed_values[0][key] for key in shared_keys))


def _focus_values(field: str, values: list[str]) -> list[str]:
    focused = [
        value
        for value in values
        if normalize_text(value) not in FOCUS_SKIP_VALUES
    ]
    if field == "method_tags":
        focused = [
            value
            for value in focused
            if normalize_text(value) in {"adna", "autosomal", "y dna", "y-dna"}
        ]
    elif field == "sites":
        focused = focused[:3]
    elif field == "periods":
        focused = [
            value
            for value in focused
            if any(char.isdigit() for char in value) or len(value.split()) >= 3
        ]
    elif field not in {"evidence_types"}:
        focused = []
    return focused[:4]


def _is_central_shared_value(field: str, value: str) -> bool:
    key = normalize_text(value)
    if not key or key in CONTEXTUAL_SHARED_VALUES:
        return False
    if field == "sites":
        return True
    if field == "date_ranges":
        return True
    if field == "method_tags":
        return key in CENTRAL_GENETIC_METHODS
    if field == "periods":
        return any(char.isdigit() for char in value) or len(value.split()) >= 3
    if field == "regions":
        directional = ("north", "south", "east", "west", "northern", "southern", "eastern", "western")
        return "(" in value or any(term in key.split() for term in directional) or len(value.split()) >= 3
    if field == "evidence_types":
        strong_terms = ("adna", "ancient dna", "genome wide", "genome-wide", "autosomal", "y chromosome", "y-chromosome")
        return any(term in key for term in strong_terms)
    return False


def _split_shared_values(shared: dict[str, list[str]]) -> tuple[dict[str, list[str]], dict[str, list[str]]]:
    central: dict[str, list[str]] = {}
    contextual: dict[str, list[str]] = {}
    for field, values in shared.items():
        central_values = [value for value in values if _is_central_shared_value(field, value)]
        contextual_values = [value for value in values if value not in central_values]
        if central_values:
            central[field] = central_values
        if contextual_values:
            contextual[field] = contextual_values
    return central, contextual


def _suggested_question(rows: list[dict[str, Any]], shared: dict[str, list[str]]) -> str:
    labels = ", ".join(str(row.get("label") or row.get("filename")) for row in rows)
    focus_parts = []
    use_focus = all(row.get("source") == "matrix_derived" for row in rows)
    for field in ("sites", "regions", "periods", "method_tags", "evidence_types"):
        values = _focus_values(field, shared.get(field) or []) if use_focus else []
        if values:
            focus_parts.append(f"{FIELD_LABELS[field]}: {', '.join(values[:4])}")
    focus = "; ".join(focus_parts)
    suffix = (
        f" en tenant compte de ces axes déjà repérés ({focus})"
        if focus
        else ""
    )
    return (
        "Compare uniquement les papiers sélectionnés sur cette question : "
        f"quelles hypothèses proposent-ils, quelles preuves et méthodes/données "
        f"mobilisent-ils, quelles périodes/datations discutent-ils, quelles limites "
        f"présentent-ils, et où divergent-ils{suffix} ? "
        f"Papiers à sélectionner: {labels}."
    )


class DifferenceService:
    """Builds Matrix-first difference summaries for selected papers."""

    def __init__(self) -> None:
        self.manifest_service = get_manifest_service()

    async def compare_papers(
        self,
        file_locations: list[str],
        include_indexed_only: bool = True,
    ) -> dict[str, Any]:
        unique_files = []
        seen: set[str] = set()
        for file_location in file_locations:
            if file_location and file_location not in seen:
                seen.add(file_location)
                unique_files.append(file_location)

        if len(unique_files) < 2:
            raise ValueError("Select at least 2 papers for Comparison Lab.")
        if len(unique_files) > 5:
            raise ValueError("Select at most 5 papers for Comparison Lab.")

        manifest = await self.manifest_service.get_manifest()
        rows = manifest.get("rows", [])
        rows_by_file = {row.get("file_location"): row for row in rows}
        missing_files = [file_location for file_location in unique_files if file_location not in rows_by_file]
        if missing_files:
            raise KeyError(", ".join(missing_files))

        selected_rows = [rows_by_file[file_location] for file_location in unique_files]
        excluded_rows: list[dict[str, Any]] = []
        if not include_indexed_only:
            excluded_rows = [row for row in selected_rows if row.get("source") == "indexed_only"]
            selected_rows = [row for row in selected_rows if row.get("source") != "indexed_only"]
            if len(selected_rows) < 2:
                raise ValueError("At least 2 Matrix papers are required when indexed_only papers are excluded.")

        shared = {
            field: values
            for field in COMPARISON_FIELDS
            if (values := _shared_values(selected_rows, field))
        }
        shared_central, shared_contextual = _split_shared_values(shared)

        differences = []
        missing_by_paper = []
        for row in selected_rows:
            paper_fields: dict[str, list[str]] = {}
            paper_missing: list[str] = []
            for field in COMPARISON_FIELDS:
                values = _as_values(row, field)
                if not values:
                    paper_missing.append(field)
                    continue
                shared_keys = set(_values_by_key(shared.get(field, []) or []))
                field_values = _values_by_key(values)
                unique_values = [
                    value
                    for key, value in field_values.items()
                    if key not in shared_keys
                ]
                if unique_values:
                    paper_fields[field] = _cap_values(field, unique_values)
            differences.append(
                {
                    "paper": _paper_summary(row),
                    "fields": paper_fields,
                    "note": _difference_note(row),
                }
            )
            missing_by_paper.append(
                {
                    "paper": _paper_summary(row),
                    "fields": paper_missing,
                }
            )

        matrix_rows = [row for row in selected_rows if row.get("source") == "matrix_derived"]
        indexed_only_rows = [row for row in selected_rows if row.get("source") == "indexed_only"]
        needs_review_rows = [row for row in selected_rows if row.get("needs_review")]
        warnings = []
        if indexed_only_rows:
            warnings.append("Certains papiers sont indexed_only: leurs différences sont limitées aux métadonnées disponibles.")
        if needs_review_rows:
            warnings.append("Certaines lignes Matrix sont à vérifier: traitez leurs différences comme provisoires.")
        if excluded_rows:
            warnings.append("Des papiers indexed_only sélectionnés ont été exclus de cette comparaison.")
        if not matrix_rows:
            warnings.append("Aucune ligne Matrix disponible pour les papiers comparés.")

        return {
            "papers": [_paper_summary(row) for row in selected_rows],
            "excluded_papers": [_paper_summary(row) for row in excluded_rows],
            "shared": shared,
            "shared_central": shared_central,
            "shared_contextual": shared_contextual,
            "differences": differences,
            "missing": missing_by_paper,
            "quality": {
                "strategy": "matrix_manifest_structured_difference",
                "paper_count": len(selected_rows),
                "matrix_rows": len(matrix_rows),
                "indexed_only_rows": len(indexed_only_rows),
                "needs_review_rows": len(needs_review_rows),
                "strong_fields": sorted(STRONG_FIELDS),
                "weak_fields": sorted(set(COMPARISON_FIELDS) - STRONG_FIELDS),
                "confidence": self._confidence(selected_rows),
            },
            "suggested_compare_question": _suggested_question(selected_rows, shared_central),
            "warnings": warnings,
        }

    def _confidence(self, rows: list[dict[str, Any]]) -> str:
        if any(row.get("source") == "indexed_only" for row in rows):
            return "low"
        if any(row.get("needs_review") for row in rows):
            return "medium"
        return "high"


_difference_service: DifferenceService | None = None


def get_difference_service() -> DifferenceService:
    global _difference_service
    if _difference_service is None:
        _difference_service = DifferenceService()
    return _difference_service
