"""Lightweight paper manifest derived from the index and Evidence Matrix.

The manifest is runtime metadata for downstream research workflows. It never
calls PaperQA retrieval or an LLM; it only normalizes already indexed papers and
matrix fields.
"""

from __future__ import annotations

import json
import pathlib
import re
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from .analysis_service import get_analysis_service
from .paper_resolver import PaperResolver, normalize_text
from .qa_service import get_qa_service

_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
MANIFEST_PATH = _PROJECT_ROOT / "data" / "analysis" / "paper_manifest.json"
MANIFEST_VERSION = 1

TAG_RULES: dict[str, tuple[str, ...]] = {
    "aDNA": (
        "adna",
        "ancient dna",
        "ancient genome",
        "ancient genomes",
        "adn ancien",
        "paleogenom",
        "paleogenomic",
        "paléogénom",
    ),
    "mtDNA": (
        "mtdna",
        "mitochondrial",
        "adn mitochondrial",
        "adnmt",
        "mitogenome",
    ),
    "autosomal": (
        "autosomal",
        "genome wide",
        "genome-wide",
        "whole genome",
        "whole-genome",
        "genome entier",
        "génome entier",
    ),
    "Y-DNA": (
        "y dna",
        "y-dna",
        "y chromosome",
        "chromosome y",
        "haplogroup y",
        "haplogroupe y",
    ),
    "radiocarbon": ("radiocarbon", "radiocarbone", "14c", "c14", "carbone 14"),
    "isotope": ("isotope", "isotopic", "isotopique"),
    "ceramic": ("ceramic", "ceramique", "céramique", "pottery", "poterie"),
    "lithics": ("lithic", "lithics", "lithique", "stone tool"),
    "zooarchaeology": ("zooarchaeology", "zooarchaeological", "zooarchéolog"),
    "archaeobotany": ("archaeobotany", "archaeobotanical", "archéobotan"),
    "stratigraphy": ("stratigraphy", "stratigraph", "stratigraphie"),
    "typology": ("typology", "typologie", "typological"),
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _empty_manifest(index_config_hash: str | None = None) -> dict[str, Any]:
    return {
        "metadata": {
            "version": MANIFEST_VERSION,
            "created_at": _now_iso(),
            "updated_at": None,
            "index_config_hash": index_config_hash,
            "matrix_updated_at": None,
            "overrides_updated_at": None,
        },
        "rows": [],
    }


def _manifest_item_values(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    values: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        value = str(item.get("value") or "").strip()
        key = normalize_text(value)
        if value and key and key not in seen:
            seen.add(key)
            values.append(value)
    return values


def _contains_any(text: str, needles: tuple[str, ...]) -> bool:
    normalized = normalize_text(text)
    padded = f" {normalized} "
    for needle in needles:
        normalized_needle = normalize_text(needle)
        if not normalized_needle:
            continue
        if " " in normalized_needle:
            if f" {normalized_needle} " in padded:
                return True
            continue
        if re.search(rf"\b{re.escape(normalized_needle)}\w*\b", normalized):
            return True
    return False


def _year_from_values(*values: Any) -> int | None:
    for value in values:
        match = re.search(r"\b((?:19|20)\d{2})\b", str(value or ""))
        if match:
            return int(match.group(1))
    return None


class PaperManifestService:
    """Builds and reads the local paper manifest."""

    def __init__(self) -> None:
        self.qa_service = get_qa_service()
        self.analysis_service = get_analysis_service()

    def load_manifest(self) -> dict[str, Any]:
        if not MANIFEST_PATH.exists():
            return _empty_manifest(self.qa_service.get_index_config_hash())
        try:
            with open(MANIFEST_PATH, encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            return _empty_manifest(self.qa_service.get_index_config_hash())
        manifest.setdefault("metadata", {})
        manifest.setdefault("rows", [])
        return manifest

    def save_manifest(self, manifest: dict[str, Any]) -> None:
        MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
        manifest.setdefault("metadata", {})
        manifest["metadata"]["version"] = MANIFEST_VERSION
        manifest["metadata"]["updated_at"] = _now_iso()
        with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2, ensure_ascii=False)

    async def get_status(self) -> dict[str, Any]:
        indexed = await self.qa_service.get_indexed_papers()
        manifest = self.load_manifest()
        metadata = manifest.get("metadata", {})
        matrix_store = self.analysis_service.load_store()
        overrides = self.analysis_service.load_overrides()
        current_hash = self.qa_service.get_index_config_hash()
        manifest_files = {
            row.get("file_location")
            for row in manifest.get("rows", [])
            if row.get("file_location")
        }
        indexed_files = {paper["file_location"] for paper in indexed}
        stale = (
            not MANIFEST_PATH.exists()
            or metadata.get("version") != MANIFEST_VERSION
            or metadata.get("index_config_hash") != current_hash
            or metadata.get("matrix_updated_at") != matrix_store.get("metadata", {}).get("updated_at")
            or metadata.get("overrides_updated_at") != overrides.get("metadata", {}).get("updated_at")
            or manifest_files != indexed_files
        )
        return {
            "exists": MANIFEST_PATH.exists(),
            "available": bool(indexed),
            "stale": stale,
            "paper_count": len(indexed),
            "row_count": len(manifest.get("rows", [])),
            "last_build_at": metadata.get("updated_at"),
            "index_config_hash": current_hash,
            "path": str(MANIFEST_PATH),
        }

    async def get_manifest(self) -> dict[str, Any]:
        status = await self.get_status()
        if status["stale"]:
            return await self.build_manifest()
        manifest = self.load_manifest()
        return {
            "metadata": manifest.get("metadata", {}),
            "rows": manifest.get("rows", []),
            "status": status,
        }

    async def build_manifest(self) -> dict[str, Any]:
        indexed = await self.qa_service.get_indexed_papers()
        current_hash = self.qa_service.get_index_config_hash()
        matrix_store = self.analysis_service.load_store()
        overrides = self.analysis_service.load_overrides()
        matrix_rows = {
            row.get("paper", {}).get("file_location"): row
            for row in matrix_store.get("rows", [])
            if row.get("paper", {}).get("file_location")
        }
        resolver = PaperResolver(indexed)
        records_by_file = {record.file_location: record for record in resolver.records}

        rows = []
        for paper in indexed:
            file_location = paper["file_location"]
            matrix_row = matrix_rows.get(file_location)
            effective_row = (
                self.analysis_service._row_with_curation(deepcopy(matrix_row), overrides)
                if matrix_row
                else None
            )
            rows.append(
                self._manifest_row(
                    paper=paper,
                    aliases=records_by_file.get(file_location),
                    matrix_row=effective_row,
                )
            )

        manifest = _empty_manifest(current_hash)
        manifest["metadata"].update(
            {
                "index_config_hash": current_hash,
                "matrix_updated_at": matrix_store.get("metadata", {}).get("updated_at"),
                "overrides_updated_at": overrides.get("metadata", {}).get("updated_at"),
            }
        )
        manifest["rows"] = rows
        self.save_manifest(manifest)
        return {
            "metadata": manifest.get("metadata", {}),
            "rows": rows,
            "status": await self.get_status(),
        }

    def _manifest_row(
        self,
        paper: dict[str, Any],
        aliases: Any,
        matrix_row: dict[str, Any] | None,
    ) -> dict[str, Any]:
        fields = matrix_row.get("fields", {}) if matrix_row else {}
        method_text = " ".join(
            value
            for field in ("methods", "materials", "evidence_types", "main_claims")
            for value in _manifest_item_values(fields.get(field))
        )
        searchable_text = " ".join(
            str(value or "")
            for value in (
                paper.get("title"),
                paper.get("citation"),
                paper.get("docname"),
                paper.get("filename"),
                method_text,
            )
        )
        label = (
            aliases.label
            if aliases is not None
            else paper.get("title") or paper.get("docname") or paper.get("filename")
        )
        alias_values = sorted(
            {
                alias
                for alias in (
                    set(getattr(aliases, "aliases", set()) or set())
                    | set(getattr(aliases, "compact_aliases", set()) or set())
                    | {
                        normalize_text(str(label or "")),
                        normalize_text(str(paper.get("filename") or "")),
                        normalize_text(str(paper.get("docname") or "")),
                    }
                )
                if alias
            }
        )

        year = paper.get("year") or _year_from_values(
            paper.get("filename"),
            paper.get("docname"),
            paper.get("title"),
            paper.get("citation"),
        )

        return {
            "file_location": paper.get("file_location"),
            "filename": paper.get("filename"),
            "docname": paper.get("docname"),
            "title": paper.get("title"),
            "year": year,
            "citation": paper.get("citation"),
            "label": label,
            "aliases": alias_values,
            "paper_kind": self._paper_kind(searchable_text, bool(matrix_row)),
            "method_tags": self._method_tags(searchable_text),
            "regions": _manifest_item_values(fields.get("regions")),
            "sites": _manifest_item_values(fields.get("sites")),
            "periods": _manifest_item_values(fields.get("periods")),
            "date_ranges": _manifest_item_values(fields.get("date_ranges")),
            "evidence_types": _manifest_item_values(fields.get("evidence_types")),
            "main_claims": _manifest_item_values(fields.get("main_claims")),
            "limitations": _manifest_item_values(fields.get("limitations")),
            "uncertainties": _manifest_item_values(fields.get("uncertainties")),
            "matrix_status": matrix_row.get("status") if matrix_row else None,
            "row_verified": bool(matrix_row.get("curation", {}).get("row_verified")) if matrix_row else False,
            "needs_review": bool(matrix_row.get("quality", {}).get("needs_review")) if matrix_row else True,
            "source": "matrix_derived" if matrix_row else "indexed_only",
        }

    def _method_tags(self, text: str) -> list[str]:
        return [
            tag
            for tag, needles in TAG_RULES.items()
            if _contains_any(text, needles)
        ]

    def _paper_kind(self, text: str, has_matrix: bool) -> str:
        normalized = normalize_text(text)
        if re.search(r"\b(?:biorxiv|arxiv|preprint|prepublication|prépublication)\b", normalized):
            return "preprint"
        if re.search(r"\b(?:review|synthesis|synthese|synthèse|overview|encyclopedia|handbook)\b", normalized):
            return "review"
        if has_matrix:
            return "primary_study"
        return "unknown"


_manifest_service: PaperManifestService | None = None


def get_manifest_service() -> PaperManifestService:
    global _manifest_service
    if _manifest_service is None:
        _manifest_service = PaperManifestService()
    return _manifest_service
