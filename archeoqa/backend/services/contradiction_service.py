"""Matrix-only candidate tension detection over the paper manifest.

Contradiction Detector V1 is deliberately conservative: it does not call
PaperQA retrieval, PaperQA query, embeddings, or an LLM. It only identifies
candidate tensions worth validating with cited Compare.
"""

from __future__ import annotations

import re
from itertools import combinations
from typing import Any, Literal

from .paper_manifest_service import get_manifest_service
from .paper_resolver import normalize_text

CONTEXT_FIELDS = ["sites", "regions", "periods", "method_tags", "evidence_types"]
TEXT_FIELDS = ["main_claims", "limitations", "uncertainties"]
GENERIC_VALUES = {
    "africa",
    "canary islands",
    "iberia",
    "late pleistocene",
    "late neolithic",
    "levant",
    "maghreb",
    "middle paleolithic",
    "middle palaeolithic",
    "middle stone age",
    "morocco",
    "mtdna",
    "neolithic",
    "north africa",
    "northwest africa",
    "primary_study",
    "radiocarbon",
    "stratigraphy",
    "typology",
    "upper palaeolithic",
    "upper paleolithic",
}
SPECIFIC_PERIODS = {
    "aterian",
    "capsian",
    "cardial neolithic",
    "dabban industry",
    "early neolithic",
    "epipalaeolithic",
    "epipaleolithic",
    "iberomaurusian",
    "late stone age",
    "middle neolithic",
    "mousterian",
    "oranian",
    "pre-pottery neolithic",
}
DATING_METHODS = {
    "ams",
    "amino acid racemization",
    "esr",
    "osl",
    "radiocarbon",
    "tl",
    "u-th",
}
STRONG_METHODS = {
    "adna",
    "ancient dna",
    "autosomal",
    "genome-wide",
    "isotope",
    "mtdna",
    "qpAdm".lower(),
    "y-dna",
}
ARCH_DATE_MARKERS = (
    " bp",
    " ybp",
    "ka",
    "bce",
    " bc",
    "cal",
    "mis",
    "years ago",
    "millennium",
)
STOPWORDS = {
    "and",
    "are",
    "but",
    "can",
    "dans",
    "des",
    "for",
    "from",
    "les",
    "not",
    "that",
    "the",
    "their",
    "this",
    "with",
}


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


def _shared(row_a: dict[str, Any], row_b: dict[str, Any], field: str) -> list[str]:
    values_a = _values_by_key(_as_values(row_a, field))
    values_b = _values_by_key(_as_values(row_b, field))
    return sorted(values_a[key] for key in set(values_a) & set(values_b))


def _is_generic(value: str) -> bool:
    return normalize_text(value) in GENERIC_VALUES


def _is_specific_period(value: str) -> bool:
    key = normalize_text(value)
    return key in SPECIFIC_PERIODS or (key not in GENERIC_VALUES and any(term in key for term in ("aterian", "ibero", "capsian", "cardial", "dabban")))


def _is_dating_method(value: str) -> bool:
    key = normalize_text(value)
    return key in DATING_METHODS


def _is_strong_method(value: str) -> bool:
    key = normalize_text(value)
    return key in STRONG_METHODS or _is_dating_method(value)


def _central_shared(shared: dict[str, list[str]]) -> dict[str, list[str]]:
    central: dict[str, list[str]] = {}
    if shared.get("sites"):
        central["sites"] = shared["sites"]

    precise_regions = [value for value in shared.get("regions", []) if not _is_generic(value)]
    if precise_regions:
        central["regions"] = precise_regions

    precise_periods = [value for value in shared.get("periods", []) if _is_specific_period(value)]
    if precise_periods:
        central["periods"] = precise_periods

    strong_methods = [value for value in shared.get("method_tags", []) if _is_strong_method(value)]
    if strong_methods:
        central["method_tags"] = strong_methods

    strong_evidence = [
        value
        for value in shared.get("evidence_types", [])
        if any(token in normalize_text(value) for token in ("date", "dna", "genome", "isotope", "chronolog"))
    ]
    if strong_evidence:
        central["evidence_types"] = strong_evidence
    return central


def _different_values(row_a: dict[str, Any], row_b: dict[str, Any], field: str) -> dict[str, list[str]]:
    values_a = _values_by_key(_as_values(row_a, field))
    values_b = _values_by_key(_as_values(row_b, field))
    shared_keys = set(values_a) & set(values_b)
    return {
        "paper_a": [value for key, value in values_a.items() if key not in shared_keys][:6],
        "paper_b": [value for key, value in values_b.items() if key not in shared_keys][:6],
    }


def _archaeological_dates(values: list[str]) -> list[str]:
    output: list[str] = []
    for value in values:
        text = str(value or "").strip()
        key = normalize_text(text)
        if not text or not key:
            continue
        if any(marker.strip() in key for marker in ARCH_DATE_MARKERS):
            output.append(text)
            continue
        if re.search(r"[~<>±]", text) and re.search(r"\d", text):
            output.append(text)
            continue
        years = [int(match) for match in re.findall(r"\b(1[5-9]\d{2}|20\d{2})\b", text)]
        if years and not any(marker in key for marker in ("bp", "bce", "bc", "cal", "ka", "mis")):
            continue
        if re.search(r"\b\d{5,}\b", text):
            output.append(text)
    return output


def _date_bucket(value: str) -> str | None:
    text = normalize_text(value)
    if "ma" in text and "mammal" not in text:
        return "deep_time"
    if "mis" in text:
        return "msa"

    numbers = [float(match.replace(",", "")) for match in re.findall(r"\d+(?:[,.]\d+)?", value)]
    if not numbers:
        return None
    max_number = max(numbers)

    if "millennium" in text and ("bc" in text or "bce" in text):
        if max_number <= 9:
            return "neolithic"
        if max_number <= 14:
            return "epipalaeolithic"
        return "upper_palaeolithic"
    if "bce" in text or " bc" in text:
        if max_number <= 8000:
            return "neolithic"
        if max_number <= 14000:
            return "epipalaeolithic"
        return "upper_palaeolithic"
    if "ka" in text or "years ago" in text or "bp" in text or "ybp" in text:
        ka = max_number
        if "bp" in text or "ybp" in text or "years ago" in text:
            ka = max_number / 1000 if max_number > 1000 else max_number
        if ka <= 12:
            return "neolithic"
        if ka <= 30:
            return "epipalaeolithic"
        if ka <= 45:
            return "upper_palaeolithic"
        if ka <= 300:
            return "msa"
        return "deep_time"
    return None


def _period_buckets(periods: list[str]) -> set[str]:
    buckets: set[str] = set()
    for period in periods:
        key = normalize_text(period)
        if "neolithic" in key:
            buckets.add("neolithic")
        if "epipalaeolithic" in key or "epipaleolithic" in key or "ibero" in key or "capsian" in key or "oranian" in key:
            buckets.add("epipalaeolithic")
        if "upper palaeolithic" in key or "upper paleolithic" in key or "late stone age" in key:
            buckets.add("upper_palaeolithic")
        if "aterian" in key or "mousterian" in key or "middle stone age" in key or "middle palaeolithic" in key or "middle paleolithic" in key:
            buckets.add("msa")
    return buckets


def _tokens(values: list[str]) -> set[str]:
    text = " ".join(values)
    tokens = set(normalize_text(text).split())
    return {token for token in tokens if len(token) >= 4 and token not in STOPWORDS}


def _text_overlap(row_a: dict[str, Any], row_b: dict[str, Any], field: str) -> float:
    tokens_a = _tokens(_as_values(row_a, field))
    tokens_b = _tokens(_as_values(row_b, field))
    if not tokens_a or not tokens_b:
        return 1.0
    return len(tokens_a & tokens_b) / max(1, min(len(tokens_a), len(tokens_b)))


def _strong_shared(shared: dict[str, list[str]]) -> bool:
    if shared.get("sites") and (shared.get("periods") or shared.get("method_tags") or shared.get("evidence_types")):
        return True
    if shared.get("regions") and shared.get("periods") and (
        shared.get("method_tags") or shared.get("evidence_types")
    ):
        return True
    return False


def _context_score(shared: dict[str, list[str]]) -> float:
    score = 0.0
    score += min(22.0, len(shared.get("sites", [])) * 8.0)
    score += min(8.0, len(shared.get("regions", [])) * 3.0)
    score += min(14.0, len(shared.get("periods", [])) * 6.0)
    score += min(6.0, len(shared.get("method_tags", [])) * 3.0)
    score += min(4.0, len(shared.get("evidence_types", [])) * 2.0)
    return score


def _confidence(
    score: float,
    row_a: dict[str, Any],
    row_b: dict[str, Any],
    shared: dict[str, list[str]],
    tension_type: str,
) -> str:
    if row_a.get("source") == "indexed_only" or row_b.get("source") == "indexed_only":
        return "low"
    if row_a.get("needs_review") or row_b.get("needs_review"):
        return "medium" if score >= 50 else "low"
    if tension_type == "dating_tension" and shared.get("sites") and shared.get("periods") and score >= 70:
        return "high"
    if score >= 45:
        return "medium"
    return "low"


def _suggested_question(candidate: dict[str, Any]) -> str:
    labels = ", ".join(paper["label"] for paper in candidate["papers"])
    tension = candidate["tension_type"].replace("_", " ")
    shared_parts = []
    for field, label in (("sites", "sites"), ("regions", "régions"), ("periods", "périodes"), ("method_tags", "méthodes")):
        values = candidate["shared"].get(field) or []
        if values:
            shared_parts.append(f"{label}: {', '.join(values[:4])}")
    shared_text = f" Axes repérés: {'; '.join(shared_parts)}." if shared_parts else ""
    return (
        "Compare uniquement les papiers sélectionnés sur cette question : "
        f"vérifie s'il existe une tension réelle ou seulement apparente ({tension}) entre ces papiers; "
        "compare leurs hypothèses, datations, méthodes, preuves, limites et incertitudes avec citations précises."
        f"{shared_text} Papiers à sélectionner: {labels}."
    )


class ContradictionService:
    """Finds Matrix-only candidate tensions between papers."""

    def __init__(self) -> None:
        self.manifest_service = get_manifest_service()

    async def find_contradictions(
        self,
        file_locations: list[str] | None = None,
        scope: Literal["selection", "corpus"] | None = None,
        include_indexed_only: bool = False,
        limit: int = 20,
    ) -> dict[str, Any]:
        manifest = await self.manifest_service.get_manifest()
        all_rows = manifest.get("rows", [])
        requested_scope = scope or ("selection" if file_locations else "corpus")

        if requested_scope == "selection":
            unique_files = []
            seen: set[str] = set()
            for file_location in file_locations or []:
                if file_location and file_location not in seen:
                    seen.add(file_location)
                    unique_files.append(file_location)
            if len(unique_files) < 2:
                raise ValueError("Select at least 2 papers for Contradiction Detector.")
            if len(unique_files) > 8:
                raise ValueError("Select at most 8 papers for Contradiction Detector V1.")
            rows_by_file = {row.get("file_location"): row for row in all_rows}
            missing_files = [file_location for file_location in unique_files if file_location not in rows_by_file]
            if missing_files:
                raise KeyError(", ".join(missing_files))
            selected_rows = [rows_by_file[file_location] for file_location in unique_files]
        else:
            selected_rows = list(all_rows)

        excluded_rows = [
            row
            for row in selected_rows
            if row.get("source") == "indexed_only" and not include_indexed_only
        ]
        candidate_rows = [
            row
            for row in selected_rows
            if include_indexed_only or row.get("source") != "indexed_only"
        ]
        matrix_rows = [row for row in candidate_rows if row.get("source") == "matrix_derived"]
        pair_rows = matrix_rows

        candidates = []
        considered_pairs = 0
        for row_a, row_b in combinations(pair_rows, 2):
            if normalize_text(row_a.get("label") or "") == normalize_text(row_b.get("label") or ""):
                continue
            considered_pairs += 1
            candidate = self._score_pair(row_a, row_b)
            if candidate:
                if requested_scope == "corpus" and candidate["score"] < 50:
                    continue
                candidates.append(candidate)
        candidates.sort(key=lambda item: (-item["score"], item["tension_type"], item["papers"][0]["label"]))
        if requested_scope == "corpus":
            deduped_candidates = []
            seen_label_pairs: set[tuple[str, str]] = set()
            for candidate in candidates:
                label_pair = tuple(sorted(normalize_text(paper["label"]) for paper in candidate["papers"]))
                if label_pair in seen_label_pairs:
                    continue
                seen_label_pairs.add(label_pair)
                deduped_candidates.append(candidate)
            candidates = deduped_candidates
        max_limit = max(1, min(limit, 100))
        candidates = candidates[:max_limit]

        warnings = [
            "Résultats prudents: V1 signale des tensions candidates, pas des contradictions confirmées."
        ]
        if excluded_rows:
            warnings.append("Des papiers indexed_only ont été exclus: construisez leur Matrix pour les inclure.")
        if any(row.get("needs_review") for row in pair_rows):
            warnings.append("Certaines lignes Matrix sont à vérifier: validez les tensions avec Compare cité.")
        if not candidates:
            warnings.append("Aucune tension candidate détectée avec les signaux Matrix actuels.")

        return {
            "scope": requested_scope,
            "papers": [_paper_summary(row) for row in candidate_rows],
            "excluded_papers": [_paper_summary(row) for row in excluded_rows],
            "candidates": candidates,
            "metadata": {
                "strategy": "matrix_manifest_candidate_tensions",
                "limit": max_limit,
                "paper_count": len(candidate_rows),
                "matrix_rows": len(matrix_rows),
                "indexed_only_rows": len([row for row in candidate_rows if row.get("source") == "indexed_only"]),
                "needs_review_rows": len([row for row in pair_rows if row.get("needs_review")]),
                "considered_pairs": considered_pairs,
                "candidate_count": len(candidates),
            },
            "warnings": warnings,
        }

    def _score_pair(self, row_a: dict[str, Any], row_b: dict[str, Any]) -> dict[str, Any] | None:
        shared_raw = {
            field: values
            for field in CONTEXT_FIELDS
            if (values := _shared(row_a, row_b, field))
        }
        shared = _central_shared(shared_raw)
        if not _strong_shared(shared):
            return None

        divergent = {}
        tension_type = "candidate_tension"
        tension_points = 0.0
        reasons = []

        periods = shared.get("periods", [])
        period_buckets = _period_buckets(periods)
        dates_a = _archaeological_dates(_as_values(row_a, "date_ranges"))
        dates_b = _archaeological_dates(_as_values(row_b, "date_ranges"))
        matching_dates_a = [
            value for value in dates_a if not period_buckets or (_date_bucket(value) in period_buckets)
        ][:6]
        matching_dates_b = [
            value for value in dates_b if not period_buckets or (_date_bucket(value) in period_buckets)
        ][:6]
        date_buckets_a = {_date_bucket(value) for value in matching_dates_a if _date_bucket(value)}
        date_buckets_b = {_date_bucket(value) for value in matching_dates_b if _date_bucket(value)}

        comparable_date_bucket = bool(date_buckets_a & date_buckets_b)

        if shared.get("sites") and periods and matching_dates_a and matching_dates_b and comparable_date_bucket:
            divergent["date_ranges"] = {
                "paper_a": matching_dates_a,
                "paper_b": matching_dates_b,
            }
            tension_type = "dating_tension"
            tension_points += 14.0
            reasons.append("chronologies ou datations à comparer sur un même site/période")

        claim_overlap = _text_overlap(row_a, row_b, "main_claims")
        claim_diff = _different_values(row_a, row_b, "main_claims")
        if (
            claim_overlap < 0.14
            and claim_diff["paper_a"]
            and claim_diff["paper_b"]
            and comparable_date_bucket
            and (shared.get("sites") and periods or shared.get("method_tags") and shared.get("periods"))
        ):
            divergent["main_claims"] = claim_diff
            if tension_type == "candidate_tension":
                tension_type = "claim_tension"
            tension_points += 5.0
            reasons.append("angles d'inférence différents dans un contexte central partagé")

        if shared.get("method_tags") or shared.get("evidence_types"):
            method_claim_overlap = min(claim_overlap, _text_overlap(row_a, row_b, "limitations"))
            if method_claim_overlap < 0.18 and comparable_date_bucket and (shared.get("sites") or shared.get("periods")):
                for field in ("limitations",):
                    diff = _different_values(row_a, row_b, field)
                    if diff["paper_a"] and diff["paper_b"]:
                        divergent[field] = diff
                if "limitations" in divergent:
                    if tension_type == "candidate_tension":
                        tension_type = "method_inference_tension"
                    tension_points += 4.0
                    reasons.append("méthodes ou preuves partagées avec limites/inférences différentes")

        uncertainty_overlap = _text_overlap(row_a, row_b, "uncertainties")
        uncertainty_diff = _different_values(row_a, row_b, "uncertainties")
        if (
            uncertainty_overlap < 0.16
            and uncertainty_diff["paper_a"]
            and uncertainty_diff["paper_b"]
            and comparable_date_bucket
            and shared.get("sites")
            and periods
        ):
            divergent["uncertainties"] = uncertainty_diff
            if tension_type == "candidate_tension":
                tension_type = "uncertainty_tension"
            tension_points += 3.0
            reasons.append("incertitudes différentes sur un même axe site/période")

        if not divergent:
            return None
        if tension_points < 14.0:
            return None

        score = round(min(88.0, _context_score(shared) + tension_points), 1)
        candidate = {
            "papers": [_paper_summary(row_a), _paper_summary(row_b)],
            "tension_type": tension_type,
            "score": score,
            "confidence": _confidence(score, row_a, row_b, shared, tension_type),
            "shared": shared,
            "divergent": divergent,
            "rationale": "Tension candidate: " + "; ".join(reasons) + ".",
            "warnings": [
                warning
                for warning in (
                    "ligne Matrix à vérifier" if row_a.get("needs_review") or row_b.get("needs_review") else "",
                    "validation citée nécessaire avant conclusion",
                )
                if warning
            ],
        }
        candidate["suggested_compare_question"] = _suggested_question(candidate)
        return candidate


_contradiction_service: ContradictionService | None = None


def get_contradiction_service() -> ContradictionService:
    global _contradiction_service
    if _contradiction_service is None:
        _contradiction_service = ContradictionService()
    return _contradiction_service
