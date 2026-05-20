"""Deterministic paper similarity over the local paper manifest.

Similarity Finder V1 is intentionally cheap: it does not call PaperQA retrieval
or an LLM. It scores indexed papers from the runtime manifest/Matrix metadata.
"""

from __future__ import annotations

import re
from typing import Any

from .paper_manifest_service import get_manifest_service
from .paper_resolver import normalize_text

FIELD_WEIGHTS: dict[str, float] = {
    "sites": 4.0,
    "regions": 2.0,
    "periods": 2.0,
    "method_tags": 2.0,
    "evidence_types": 1.25,
    "date_ranges": 0.75,
    "main_claims": 1.0,
    "paper_kind": 0.15,
}

METADATA_WEIGHT = 0.35
SITE_BONUS = 1.5
SPECIFIC_REGION_BONUS = 0.7
PERIOD_METHOD_BONUS = 0.9
GENETIC_METHOD_BONUS = 1.0
TITLE_SITE_BONUS = 2.5
MAX_BONUS = (
    SITE_BONUS
    + SPECIFIC_REGION_BONUS
    + PERIOD_METHOD_BONUS
    + GENETIC_METHOD_BONUS
    + TITLE_SITE_BONUS
)
TOTAL_WEIGHT = sum(FIELD_WEIGHTS.values()) + MAX_BONUS

STOPWORDS = {
    "about",
    "after",
    "ancient",
    "archaeological",
    "archaeology",
    "article",
    "before",
    "between",
    "from",
    "history",
    "north",
    "paper",
    "past",
    "prehistoric",
    "study",
    "the",
    "this",
    "through",
    "using",
    "with",
}

GENERIC_VALUES = {
    "aterian": 0.55,
    "epipalaeolithic": 0.75,
    "epipaleolithic": 0.75,
    "iberomaurusian": 0.75,
    "lithics": 0.45,
    "maghreb": 0.55,
    "middle paleolithic": 0.75,
    "middle palaeolithic": 0.75,
    "middle stone age msa": 0.75,
    "mousterian": 0.75,
    "neolithic": 0.65,
    "primary study": 0.2,
    "primary_study": 0.2,
    "radiocarbon": 0.45,
    "radiocarbon dates": 0.45,
    "stratigraphy": 0.45,
    "typology": 0.45,
    "ceramic": 0.6,
    "ceramics": 0.6,
}

GENETIC_TAGS = {"adna", "mtdna", "autosomal", "y dna", "y-dna", "y dna"}
FIELD_LABELS = {
    "sites": "sites",
    "title_site_matches": "site dans le titre",
    "regions": "régions",
    "periods": "périodes",
    "method_tags": "méthodes",
    "evidence_types": "types de preuve",
    "date_ranges": "dates",
    "main_claims": "claims",
    "paper_kind": "type d'article",
    "metadata": "métadonnées",
}


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    return [text] if text else []


def _normalized_values(values: Any) -> dict[str, str]:
    output: dict[str, str] = {}
    for value in _as_list(values):
        key = normalize_text(value)
        if key and key not in output:
            output[key] = value
    return output


def _token_set(row: dict[str, Any]) -> set[str]:
    text = " ".join(
        str(value or "")
        for value in (
            row.get("label"),
            row.get("title"),
            row.get("citation"),
            row.get("docname"),
            row.get("filename"),
            " ".join(row.get("aliases") or []),
        )
    )
    return {
        token
        for token in re.findall(r"[a-z0-9]+", normalize_text(text))
        if len(token) >= 4 and token not in STOPWORDS
    }


def _value_factor(value: str) -> float:
    key = normalize_text(value)
    return GENERIC_VALUES.get(key, 1.0)


def _overlap(source_values: Any, target_values: Any) -> tuple[list[str], float, bool]:
    source = _normalized_values(source_values)
    target = _normalized_values(target_values)
    if not source or not target:
        return [], 0.0, bool(source or target)
    shared_keys = set(source) & set(target)
    shared = sorted(source[key] for key in shared_keys)
    weighted_shared = sum(_value_factor(source[key]) for key in shared_keys)
    source_weight = sum(_value_factor(value) for value in source.values())
    target_weight = sum(_value_factor(value) for value in target.values())
    denominator = min(source_weight, target_weight)
    return shared, weighted_shared / denominator if denominator else 0.0, False


def _metadata_overlap(
    source: dict[str, Any],
    target: dict[str, Any],
) -> tuple[list[str], float, bool]:
    source_tokens = _token_set(source)
    target_tokens = _token_set(target)
    if not source_tokens or not target_tokens:
        return [], 0.0, bool(source_tokens or target_tokens)
    shared = sorted(source_tokens & target_tokens)
    denominator = min(len(source_tokens), len(target_tokens))
    return shared[:8], len(shared) / denominator if denominator else 0.0, False


def _source_penalty(source: dict[str, Any], target: dict[str, Any]) -> float:
    source_indexed = source.get("source") == "indexed_only"
    target_indexed = target.get("source") == "indexed_only"
    if source_indexed and target_indexed:
        return 0.45
    if source_indexed:
        return 0.55
    if target_indexed:
        return 0.65
    return 1.0


def _confidence(score: float, source: dict[str, Any], target: dict[str, Any]) -> str:
    if source.get("source") == "indexed_only" or target.get("source") == "indexed_only":
        return "low" if score < 30 else "medium"
    if score >= 35:
        return "high"
    if score >= 15:
        return "medium"
    return "low"


def _paper_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "file_location": row.get("file_location"),
        "filename": row.get("filename"),
        "docname": row.get("docname"),
        "title": row.get("title"),
        "year": row.get("year"),
        "citation": row.get("citation"),
        "label": row.get("label"),
    }


def _is_indexed_pair(source: dict[str, Any], target: dict[str, Any]) -> bool:
    return source.get("source") == "indexed_only" or target.get("source") == "indexed_only"


def _specific_regions(values: list[str]) -> list[str]:
    return [value for value in values if _value_factor(value) >= 0.9]


def _has_genetic_overlap(values: list[str]) -> bool:
    return bool({normalize_text(value) for value in values} & GENETIC_TAGS)


def _row_title_text(row: dict[str, Any]) -> str:
    return normalize_text(
        " ".join(
            str(row.get(field) or "")
            for field in ("label", "title", "docname", "filename")
        )
    )


def _site_title_matches(source: dict[str, Any], target: dict[str, Any]) -> list[str]:
    source_text = f" {_row_title_text(source)} "
    target_text = f" {_row_title_text(target)} "
    matches: list[str] = []
    seen: set[str] = set()
    for site in _as_list(source.get("sites")):
        normalized_site = normalize_text(site)
        if len(normalized_site) < 4:
            continue
        site_tokens = [
            token
            for token in normalized_site.split()
            if len(token) >= 4 and token not in STOPWORDS
        ]
        if not site_tokens:
            continue
        source_has_site = (
            f" {normalized_site} " in source_text
            or any(re.search(rf"\b{re.escape(token)}\b", source_text) for token in site_tokens)
        )
        target_has_site = (
            f" {normalized_site} " in target_text
            or any(re.search(rf"\b{re.escape(token)}\b", target_text) for token in site_tokens)
        )
        if source_has_site and target_has_site:
            # Require the same informative token to occur on both sides. This avoids
            # broad Matrix site lists turning any site mention in a target title into
            # a bonus when the source title is about a different locality.
            shared_tokens = [
                token
                for token in site_tokens
                if re.search(rf"\b{re.escape(token)}\b", source_text)
                and re.search(rf"\b{re.escape(token)}\b", target_text)
            ]
            if not (f" {normalized_site} " in source_text and f" {normalized_site} " in target_text) and not shared_tokens:
                continue
            key = normalize_text(site)
            if key not in seen:
                seen.add(key)
                matches.append(site)
    return matches


def _bonus_score(shared: dict[str, list[str]]) -> float:
    bonus = 0.0
    if shared.get("sites"):
        bonus += min(SITE_BONUS, 0.55 * len(shared["sites"]))
    if specific_regions := _specific_regions(shared.get("regions", [])):
        bonus += min(SPECIFIC_REGION_BONUS, 0.35 * len(specific_regions))
    if shared.get("periods") and shared.get("method_tags"):
        bonus += PERIOD_METHOD_BONUS
    if _has_genetic_overlap(shared.get("method_tags", [])):
        bonus += GENETIC_METHOD_BONUS
    if shared.get("title_site_matches"):
        bonus += min(TITLE_SITE_BONUS, 2.0 + 0.35 * len(shared["title_site_matches"]))
    return bonus


def _generic_only(shared: dict[str, list[str]]) -> bool:
    meaningful_fields = [
        field
        for field in ("sites", "regions", "periods", "method_tags", "evidence_types")
        if shared.get(field)
    ]
    if not meaningful_fields:
        return True
    return all(
        all(_value_factor(value) < 0.8 for value in shared.get(field, []))
        for field in meaningful_fields
    )


def _rationale(shared: dict[str, list[str]], score: float, indexed_pair: bool) -> str:
    priority = ["sites", "title_site_matches", "regions", "periods", "method_tags", "evidence_types"]
    parts = [
        f"{FIELD_LABELS[field]}: {', '.join(values[:3])}"
        for field in priority
        if (values := shared.get(field))
    ]
    if parts:
        prefix = "Similarité large portée par " if _generic_only(shared) else "Similarité portée par "
        return prefix + "; ".join(parts) + "."
    if indexed_pair and shared.get("metadata"):
        return "Similarité faible fondée surtout sur les métadonnées textuelles."
    if score > 0:
        return "Similarité faible fondée sur peu de signaux communs."
    return "Aucun signal structuré commun détecté."


class SimilarityService:
    """Scores manifest rows for researcher-facing paper similarity."""

    def __init__(self) -> None:
        self.manifest_service = get_manifest_service()

    async def find_similar(
        self,
        file_location: str,
        limit: int = 10,
        include_indexed_only: bool = True,
    ) -> dict[str, Any]:
        manifest = await self.manifest_service.get_manifest()
        rows = manifest.get("rows", [])
        source = next(
            (row for row in rows if row.get("file_location") == file_location),
            None,
        )
        if source is None:
            raise KeyError(file_location)

        candidates = []
        for target in rows:
            if target.get("file_location") == file_location:
                continue
            if not include_indexed_only and target.get("source") == "indexed_only":
                continue
            candidates.append(self._score_pair(source, target))

        candidates.sort(key=lambda item: (-item["score"], item["paper"]["label"] or ""))
        matrix_rows = [
            row for row in rows if row.get("source") == "matrix_derived"
        ]
        warnings = []
        if not matrix_rows:
            warnings.append(
                "Aucune ligne Matrix disponible: résultats limités aux métadonnées indexées."
            )
        elif len(matrix_rows) < len(rows):
            warnings.append(
                "Matrix partielle: les papiers indexed_only ont une similarité moins fiable."
            )

        return {
            "source_paper": _paper_summary(source),
            "results": candidates[: max(1, min(limit, 50))],
            "metadata": {
                "strategy": "matrix_manifest_weighted_overlap",
                "limit": limit,
                "include_indexed_only": include_indexed_only,
                "matrix_rows": len(matrix_rows),
                "indexed_only_rows": len(rows) - len(matrix_rows),
                "total_candidates": len(candidates),
            },
            "warnings": warnings,
        }

    def _score_pair(
        self,
        source: dict[str, Any],
        target: dict[str, Any],
    ) -> dict[str, Any]:
        raw_score = 0.0
        shared: dict[str, list[str]] = {}
        missing = {"source": [], "target": []}
        indexed_pair = _is_indexed_pair(source, target)

        for field, weight in FIELD_WEIGHTS.items():
            if field == "paper_kind":
                source_values = [] if source.get(field) in {None, "unknown"} else [source[field]]
                target_values = [] if target.get(field) in {None, "unknown"} else [target[field]]
            else:
                source_values = source.get(field) or []
                target_values = target.get(field) or []
            common, overlap_score, has_missing = _overlap(source_values, target_values)
            if common and not (field == "paper_kind" and common == ["primary_study"]):
                shared[field] = common
            raw_score += weight * overlap_score
            if has_missing:
                if not source_values:
                    missing["source"].append(field)
                if not target_values:
                    missing["target"].append(field)

        title_site_matches = _site_title_matches(source, target)
        if title_site_matches:
            shared["title_site_matches"] = title_site_matches

        if indexed_pair:
            metadata_shared, metadata_score, metadata_missing = _metadata_overlap(source, target)
            if metadata_shared:
                shared["metadata"] = metadata_shared
            raw_score += METADATA_WEIGHT * metadata_score
            if metadata_missing:
                if not _token_set(source):
                    missing["source"].append("metadata")
                if not _token_set(target):
                    missing["target"].append("metadata")

        raw_score += _bonus_score(shared)
        score = round((raw_score / TOTAL_WEIGHT) * 100 * _source_penalty(source, target), 1)
        return {
            "paper": _paper_summary(target),
            "score": score,
            "confidence": _confidence(score, source, target),
            "shared": shared,
            "missing": missing,
            "source": target.get("source") or "indexed_only",
            "matrix_status": target.get("matrix_status"),
            "needs_review": bool(target.get("needs_review")),
            "rationale": _rationale(shared, score, indexed_pair),
        }


_similarity_service: SimilarityService | None = None


def get_similarity_service() -> SimilarityService:
    global _similarity_service
    if _similarity_service is None:
        _similarity_service = SimilarityService()
    return _similarity_service
