"""Deterministic Matrix coverage gaps over the local paper manifest.

Gap Finder V1 is a cheap planning workflow. It reads the manifest/Matrix-derived
metadata only; it does not call PaperQA retrieval, PaperQA query, embeddings, or
an LLM.
"""

from __future__ import annotations

from typing import Any, Literal

from .paper_manifest_service import get_manifest_service

GAP_FIELDS = [
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

FIELD_LABELS = {
    "sites": "Sites",
    "regions": "Régions",
    "periods": "Périodes",
    "date_ranges": "Dates",
    "method_tags": "Méthodes",
    "evidence_types": "Types de preuve",
    "main_claims": "Claims",
    "limitations": "Limites",
    "uncertainties": "Incertitudes",
    "paper_kind": "Type",
}

WEAK_MIN_VALUES = {
    "regions": 2,
    "periods": 2,
    "date_ranges": 2,
    "method_tags": 2,
    "evidence_types": 2,
    "main_claims": 2,
    "limitations": 2,
    "uncertainties": 2,
}

HIGH_VALUE_FIELDS = {"sites", "regions", "periods", "method_tags", "main_claims", "limitations", "uncertainties"}


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


def _field_values(row: dict[str, Any], field: str) -> list[str]:
    value = row.get(field)
    if field == "paper_kind":
        return [] if value in {None, "", "unknown"} else [str(value)]
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item or "").strip()]


def _missing_fields(row: dict[str, Any]) -> list[str]:
    return [field for field in GAP_FIELDS if not _field_values(row, field)]


def _weak_fields(row: dict[str, Any]) -> list[str]:
    weak: list[str] = []
    if row.get("source") == "indexed_only":
        return weak
    for field, minimum in WEAK_MIN_VALUES.items():
        values = _field_values(row, field)
        if values and len(values) < minimum:
            weak.append(field)
    return weak


def _field_gap_summary(rows: list[dict[str, Any]], field: str) -> dict[str, Any]:
    missing_papers = []
    weak_papers = []
    present = 0
    for row in rows:
        values = _field_values(row, field)
        if not values:
            missing_papers.append(_paper_summary(row))
            continue
        present += 1
        if row.get("source") != "indexed_only" and len(values) < WEAK_MIN_VALUES.get(field, 1):
            weak_papers.append(_paper_summary(row))
    total = len(rows)
    return {
        "field": field,
        "label": FIELD_LABELS.get(field, field),
        "present_count": present,
        "missing_count": len(missing_papers),
        "weak_count": len(weak_papers),
        "coverage_ratio": round(present / total, 3) if total else 0,
        "missing_papers": missing_papers[:8],
        "weak_papers": weak_papers[:8],
    }


def _gap_severity(row: dict[str, Any], missing: list[str], weak: list[str]) -> str:
    if row.get("source") == "indexed_only":
        return "high"
    high_value_missing = len([field for field in missing if field in HIGH_VALUE_FIELDS])
    if row.get("needs_review") or high_value_missing >= 3:
        return "medium"
    if missing or weak:
        return "low"
    return "none"


def _paper_actions(row: dict[str, Any], missing: list[str], weak: list[str]) -> list[str]:
    actions = []
    if row.get("source") == "indexed_only":
        actions.append("build_matrix_selection")
    if row.get("needs_review"):
        actions.append("verify_matrix_row")
    if missing or weak:
        actions.append("inspect_matrix_row")
    if _field_values(row, "sites") or _field_values(row, "regions") or _field_values(row, "method_tags"):
        actions.append("find_similar")
    return actions


def _gap_reasons(row: dict[str, Any], missing: list[str], weak: list[str]) -> list[str]:
    reasons = []
    if row.get("source") == "indexed_only":
        reasons.append("indexed_only")
    if row.get("needs_review"):
        reasons.append("needs_review")
    if missing:
        reasons.append("missing_fields")
    if weak:
        reasons.append("weak_fields")
    return reasons


def _action_summary(rows: list[dict[str, Any]], gap_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    indexed_only = [row for row in rows if row.get("source") == "indexed_only"]
    needs_review = [row for row in rows if row.get("needs_review")]
    incomplete = [
        item["paper"]["file_location"]
        for item in gap_rows
        if item["severity"] in {"high", "medium"} and item["paper"].get("file_location")
    ]
    actions: list[dict[str, Any]] = []
    if indexed_only:
        actions.append(
            {
                "type": "build_matrix_selection",
                "label": "Construire Matrix sélection",
                "description": "Compléter les papiers indexed_only avec un build cheap sélectionné.",
                "priority": "high",
                "file_locations": [row.get("file_location") for row in indexed_only if row.get("file_location")],
            }
        )
    if needs_review:
        actions.append(
            {
                "type": "verify_matrix_rows",
                "label": "Vérifier lignes Matrix",
                "description": "Relire ou valider les lignes Matrix marquées à vérifier.",
                "priority": "medium",
                "file_locations": [row.get("file_location") for row in needs_review if row.get("file_location")],
            }
        )
    if incomplete:
        actions.append(
            {
                "type": "inspect_matrix_rows",
                "label": "Inspecter champs faibles",
                "description": "Examiner les champs manquants ou faibles avant Similarity/Comparison.",
                "priority": "medium",
                "file_locations": incomplete[:12],
            }
        )
    if len(rows) >= 2:
        actions.append(
            {
                "type": "open_comparison_lab",
                "label": "Ouvrir Comparison Lab",
                "description": "Comparer les papiers sélectionnés une fois les gaps critiques compris.",
                "priority": "low",
                "file_locations": [row.get("file_location") for row in rows if row.get("file_location")],
            }
        )
    if rows:
        actions.append(
            {
                "type": "open_similarity",
                "label": "Chercher papiers similaires",
                "description": "Identifier des papiers proches pour compléter un groupe de comparaison.",
                "priority": "low",
                "file_locations": [rows[0].get("file_location")] if rows[0].get("file_location") else [],
            }
        )
    return actions


def _review_only_gap(gap: dict[str, Any]) -> bool:
    return gap.get("reasons") == ["needs_review"]


class GapService:
    """Finds Matrix coverage gaps for selected papers or the whole manifest."""

    def __init__(self) -> None:
        self.manifest_service = get_manifest_service()

    async def find_gaps(
        self,
        file_locations: list[str] | None = None,
        include_indexed_only: bool = True,
        scope: Literal["selection", "corpus"] | None = None,
    ) -> dict[str, Any]:
        manifest = await self.manifest_service.get_manifest()
        all_rows = manifest.get("rows", [])
        requested_scope = scope or ("selection" if file_locations else "corpus")

        excluded_rows: list[dict[str, Any]] = []
        if requested_scope == "selection":
            unique_files = []
            seen: set[str] = set()
            for file_location in file_locations or []:
                if file_location and file_location not in seen:
                    seen.add(file_location)
                    unique_files.append(file_location)
            if not unique_files:
                raise ValueError("Select at least one paper or use corpus scope.")
            rows_by_file = {row.get("file_location"): row for row in all_rows}
            missing_files = [file_location for file_location in unique_files if file_location not in rows_by_file]
            if missing_files:
                raise KeyError(", ".join(missing_files))
            rows = [rows_by_file[file_location] for file_location in unique_files]
        else:
            rows = list(all_rows)

        if not include_indexed_only:
            excluded_rows = [row for row in rows if row.get("source") == "indexed_only"]
            rows = [row for row in rows if row.get("source") != "indexed_only"]

        gap_rows = []
        for row in rows:
            missing = _missing_fields(row)
            weak = _weak_fields(row)
            severity = _gap_severity(row, missing, weak)
            if severity == "none":
                continue
            gap_rows.append(
                {
                    "paper": _paper_summary(row),
                    "missing_fields": missing,
                    "weak_fields": weak,
                    "reasons": _gap_reasons(row, missing, weak),
                    "severity": severity,
                    "recommended_actions": _paper_actions(row, missing, weak),
                }
            )
        review_gaps = [gap for gap in gap_rows if _review_only_gap(gap)]
        completion_gaps = [gap for gap in gap_rows if not _review_only_gap(gap)]

        matrix_rows = [row for row in rows if row.get("source") == "matrix_derived"]
        indexed_only_rows = [row for row in rows if row.get("source") == "indexed_only"]
        needs_review_rows = [row for row in rows if row.get("needs_review")]
        verified_rows = [row for row in rows if row.get("row_verified")]
        warnings = []
        if indexed_only_rows:
            warnings.append("Certains papiers sont indexed_only: construisez une Matrix sélectionnée pour obtenir des gaps structurés.")
        if needs_review_rows:
            warnings.append("Certaines lignes Matrix sont à vérifier: les gaps peuvent refléter une extraction incomplète.")
        if excluded_rows:
            warnings.append("Des papiers indexed_only ont été exclus de l'analyse.")
        if not rows:
            warnings.append("Aucun papier à analyser dans ce périmètre.")

        return {
            "scope": requested_scope,
            "papers": [_paper_summary(row) for row in rows],
            "excluded_papers": [_paper_summary(row) for row in excluded_rows],
            "summary": {
                "strategy": "matrix_manifest_gap_scan",
                "paper_count": len(rows),
                "total_manifest_rows": len(all_rows),
                "matrix_rows": len(matrix_rows),
                "indexed_only_rows": len(indexed_only_rows),
                "needs_review_rows": len(needs_review_rows),
                "verified_rows": len(verified_rows),
                "gap_paper_count": len(gap_rows),
                "review_only_count": len(review_gaps),
                "completion_gap_count": len(completion_gaps),
            },
            "paper_gaps": gap_rows,
            "review_gaps": review_gaps,
            "completion_gaps": completion_gaps,
            "field_gaps": [_field_gap_summary(rows, field) for field in GAP_FIELDS],
            "actions": _action_summary(rows, gap_rows),
            "warnings": warnings,
        }


_gap_service: GapService | None = None


def get_gap_service() -> GapService:
    global _gap_service
    if _gap_service is None:
        _gap_service = GapService()
    return _gap_service
