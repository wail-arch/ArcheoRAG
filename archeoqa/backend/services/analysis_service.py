"""Evidence Matrix service.

Builds a persistent archaeology-focused matrix from PaperQA-grounded evidence.
Generated extraction and researcher curation are stored separately so rebuilds do
not overwrite manual corrections.
"""

from __future__ import annotations

import json
import logging
import pathlib
from copy import deepcopy
from datetime import UTC, datetime
from typing import Any

from aviary.core import Message
from paperqa.types import PQASession

from .qa_service import _serialize_context, get_qa_service

logger = logging.getLogger(__name__)

_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
MATRIX_PATH = _PROJECT_ROOT / "data" / "analysis" / "evidence_matrix.json"
OVERRIDES_PATH = _PROJECT_ROOT / "data" / "analysis" / "evidence_matrix_overrides.json"
MATRIX_VERSION = 2

PASS_QUERIES = {
    "context": (
        "For this archaeology paper only, extract the regions, sites, cultural or "
        "chronological periods, and date ranges discussed. Focus on explicit "
        "archaeological context and chronology."
    ),
    "methods": (
        "For this archaeology paper only, extract the research methods, material "
        "categories, and evidence types used or discussed. Include methods such as "
        "radiocarbon dating, stratigraphy, typology, aDNA, isotope analysis, ceramic "
        "analysis, lithics, zooarchaeology, archaeobotany, survey, or excavation when present."
    ),
    "interpretation": (
        "For this archaeology paper only, extract the main research claims, stated "
        "limitations, uncertainties, debates, and unresolved questions. Focus on "
        "interpretive conclusions and explicit caveats."
    ),
}

PASS_FIELDS = {
    "context": ["regions", "sites", "periods", "date_ranges"],
    "methods": ["methods", "materials", "evidence_types"],
    "interpretation": ["main_claims", "limitations", "uncertainties"],
}

ALL_FIELDS = [
    "regions",
    "sites",
    "periods",
    "date_ranges",
    "methods",
    "materials",
    "evidence_types",
    "main_claims",
    "limitations",
    "uncertainties",
]

KEY_FIELDS = [
    "regions",
    "sites",
    "periods",
    "methods",
    "materials",
    "evidence_types",
    "main_claims",
    "limitations",
]

FIELD_GROUPS = {
    "context": ["regions", "sites", "periods", "date_ranges"],
    "methods": ["methods", "materials", "evidence_types"],
    "interpretation": ["main_claims", "limitations", "uncertainties"],
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _empty_store(index_config_hash: str | None = None) -> dict[str, Any]:
    return {
        "metadata": {
            "version": MATRIX_VERSION,
            "created_at": _now_iso(),
            "updated_at": None,
            "index_config_hash": index_config_hash,
        },
        "rows": [],
    }


def _empty_overrides() -> dict[str, Any]:
    return {
        "metadata": {
            "version": MATRIX_VERSION,
            "created_at": _now_iso(),
            "updated_at": None,
        },
        "rows": {},
    }


def _empty_fields() -> dict[str, list[dict[str, Any]]]:
    return {field: [] for field in ALL_FIELDS}


def _extract_json_object(text: str) -> dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("LLM response did not contain a JSON object")
    return json.loads(text[start : end + 1])


def _normalize_confidence(value: Any, evidence_count: int) -> str:
    if value in {"high", "medium", "low"}:
        return value
    if evidence_count > 1:
        return "high"
    if evidence_count == 1:
        return "medium"
    return "low"


class EvidenceMatrixService:
    """Builds and reads the persistent evidence matrix."""

    def __init__(self) -> None:
        self.qa_service = get_qa_service()

    def load_store(self) -> dict[str, Any]:
        if not MATRIX_PATH.exists():
            return _empty_store(self.qa_service.get_index_config_hash())
        try:
            with open(MATRIX_PATH, encoding="utf-8") as f:
                store = json.load(f)
        except Exception:
            logger.exception("Could not read evidence matrix")
            return _empty_store(self.qa_service.get_index_config_hash())

        store.setdefault("metadata", {})
        store.setdefault("rows", [])
        for row in store["rows"]:
            self._normalize_generated_row(row)
        return store

    def save_store(self, store: dict[str, Any]) -> None:
        MATRIX_PATH.parent.mkdir(parents=True, exist_ok=True)
        store.setdefault("metadata", {})
        store["metadata"]["version"] = MATRIX_VERSION
        store["metadata"]["updated_at"] = _now_iso()
        with open(MATRIX_PATH, "w", encoding="utf-8") as f:
            json.dump(store, f, indent=2, ensure_ascii=False)

    def load_overrides(self) -> dict[str, Any]:
        if not OVERRIDES_PATH.exists():
            return _empty_overrides()
        try:
            with open(OVERRIDES_PATH, encoding="utf-8") as f:
                overrides = json.load(f)
        except Exception:
            logger.exception("Could not read evidence matrix overrides")
            return _empty_overrides()

        overrides.setdefault("metadata", {})
        overrides.setdefault("rows", {})
        return overrides

    def save_overrides(self, overrides: dict[str, Any]) -> None:
        OVERRIDES_PATH.parent.mkdir(parents=True, exist_ok=True)
        overrides.setdefault("metadata", {})
        overrides["metadata"]["version"] = MATRIX_VERSION
        overrides["metadata"]["updated_at"] = _now_iso()
        with open(OVERRIDES_PATH, "w", encoding="utf-8") as f:
            json.dump(overrides, f, indent=2, ensure_ascii=False)

    async def get_status(self) -> dict[str, Any]:
        indexed = await self.qa_service.get_indexed_papers()
        store = self.load_store()
        rows = store.get("rows", [])
        current_hash = self.qa_service.get_index_config_hash()
        indexed_files = {paper["file_location"] for paper in indexed}
        row_files = {
            row.get("paper", {}).get("file_location")
            for row in rows
            if row.get("index_config_hash") == current_hash
        }
        failed = [
            row.get("paper", {}).get("file_location")
            for row in rows
            if row.get("status") == "failed"
        ]

        matrix_exists = MATRIX_PATH.exists()
        stale = bool(indexed_files) and (
            store.get("metadata", {}).get("index_config_hash") != current_hash
            or indexed_files != row_files
        )
        return {
            "exists": matrix_exists,
            "available": bool(indexed),
            "stale": stale,
            "paper_count": len(indexed),
            "row_count": len(rows),
            "last_build_at": store.get("metadata", {}).get("updated_at"),
            "index_config_hash": current_hash,
            "failed_papers": [item for item in failed if item],
        }

    async def get_matrix(self) -> dict[str, Any]:
        store = self.load_store()
        overrides = self.load_overrides()
        return {
            "metadata": store.get("metadata", {}),
            "rows": [
                self._row_with_curation(row, overrides)
                for row in store.get("rows", [])
            ],
            "status": await self.get_status(),
        }

    async def reset_matrix(self, clear_overrides: bool = True) -> dict[str, Any]:
        """Clear persisted matrix rows and optionally researcher overrides."""
        for path in (MATRIX_PATH, OVERRIDES_PATH if clear_overrides else None):
            if path and path.exists():
                path.unlink()
        return await self.get_matrix()

    async def build_matrix(self, force: bool = False) -> dict[str, Any]:
        indexed = await self.qa_service.get_indexed_papers()
        current_hash = self.qa_service.get_index_config_hash()
        store = self.load_store()
        rows = store.get("rows", [])
        rows_by_file = {
            row.get("paper", {}).get("file_location"): row
            for row in rows
            if row.get("paper", {}).get("file_location")
        }

        analyzed = 0
        skipped = 0
        failed = 0

        for paper in indexed:
            file_location = paper["file_location"]
            existing = rows_by_file.get(file_location)
            if (
                not force
                and existing
                and existing.get("index_config_hash") == current_hash
                and existing.get("status")
                in {"complete", "partial", "needs_review", "verified"}
            ):
                skipped += 1
                continue

            try:
                row = await self._analyze_paper(paper, current_hash)
                analyzed += 1
                if row["status"] == "failed":
                    failed += 1
            except Exception as exc:
                logger.exception("Evidence matrix extraction failed for %s", file_location)
                row = self._failed_row(paper, current_hash, str(exc))
                failed += 1

            rows_by_file[file_location] = row
            store["rows"] = list(rows_by_file.values())
            store["metadata"] = {
                **store.get("metadata", {}),
                "index_config_hash": current_hash,
            }
            self.save_store(store)

        indexed_files = {paper["file_location"] for paper in indexed}
        store["rows"] = [
            row
            for row in rows_by_file.values()
            if row.get("paper", {}).get("file_location") in indexed_files
        ]
        store["metadata"] = {
            **store.get("metadata", {}),
            "index_config_hash": current_hash,
        }
        self.save_store(store)

        return {
            "analyzed": analyzed,
            "skipped": skipped,
            "failed": failed,
            "total": len(indexed),
            "matrix": await self.get_matrix(),
        }

    async def _analyze_paper(
        self, paper: dict[str, Any], index_config_hash: str
    ) -> dict[str, Any]:
        fields = _empty_fields()
        contexts_by_id: dict[str, dict[str, Any]] = {}
        dropped_items: list[dict[str, Any]] = []

        docs = await self.qa_service._load_docs_from_index([paper["file_location"]])
        if not docs.docs:
            return self._failed_row(
                paper,
                index_config_hash,
                "Indexed PaperQA document could not be loaded.",
            )

        for pass_name, query in PASS_QUERIES.items():
            session = PQASession(question=query)
            session = await docs.aget_evidence(session, settings=self.qa_service.settings)
            pass_contexts = [_serialize_context(ctx) for ctx in session.contexts]
            for ctx in pass_contexts:
                contexts_by_id[ctx["id"]] = ctx

            if not pass_contexts:
                continue

            extracted = await self._extract_pass_fields(
                pass_name=pass_name,
                contexts=pass_contexts,
            )
            valid_ids = set(contexts_by_id)
            for field in PASS_FIELDS[pass_name]:
                valid_items, dropped = self._validated_items(
                    extracted.get(field, []),
                    valid_ids,
                    field,
                )
                fields[field].extend(valid_items)
                dropped_items.extend(dropped)

        fields = self._dedupe_fields(fields)
        quality = self._compute_quality(fields, dropped_items)
        status = self._status_from_quality(quality)
        return {
            "paper": paper,
            "generated_fields": deepcopy(fields),
            "fields": fields,
            "contexts": list(contexts_by_id.values()),
            "status": status,
            "quality": quality,
            "dropped_items": dropped_items,
            "updated_at": _now_iso(),
            "index_config_hash": index_config_hash,
        }

    async def _extract_pass_fields(
        self,
        pass_name: str,
        contexts: list[dict[str, Any]],
    ) -> dict[str, Any]:
        context_lines = []
        for ctx in contexts:
            doc = ctx["text"]["doc"]
            context_lines.append(
                json.dumps(
                    {
                        "id": ctx["id"],
                        "paper": doc.get("citation") or doc.get("docname"),
                        "chunk": ctx["text"]["name"],
                        "score": ctx["score"],
                        "summary": ctx["context"],
                        "excerpt": ctx["text"]["text"],
                    },
                    ensure_ascii=False,
                )
            )

        fields = PASS_FIELDS[pass_name]
        schema = {
            field: [
                {
                    "value": "short extracted value",
                    "confidence": "high|medium|low",
                    "evidence_ids": ["context id"],
                }
            ]
            for field in fields
        }
        prompt = (
            "You extract structured archaeology research metadata only from the "
            "provided PaperQA contexts. Do not use outside knowledge. Do not infer "
            "unsupported facts. Every item must cite one or more context ids from "
            "the provided contexts. Return only valid JSON matching this schema:\n"
            f"{json.dumps(schema, ensure_ascii=False)}\n\n"
            "Rules:\n"
            "- Use concise, normalized values suitable for a research matrix.\n"
            "- A region is a geographic area; a site is a named archaeological locality.\n"
            "- A period is a cultural or chronological label; a date_range is an explicit absolute or relative date span.\n"
            "- A method is an analytical procedure; a material is the studied object/substance; an evidence_type is the class of archaeological evidence.\n"
            "- main_claims must be interpretive conclusions, not generic background.\n"
            "- limitations must be explicit caveats or constraints stated by the paper, not your inferred future work.\n"
            "- Drop any item that is not directly supported by a context.\n"
            "- confidence is high for direct repeated support, medium for direct single "
            "support, low for ambiguous but still explicit support.\n\n"
            "PaperQA contexts:\n"
            + "\n".join(context_lines)
        )

        llm = self.qa_service.settings.get_llm()
        result = await llm.call_single(
            messages=[
                Message(role="system", content="Return grounded JSON only."),
                Message(role="user", content=prompt),
            ],
            name=f"evidence_matrix_{pass_name}",
        )
        data = _extract_json_object(str(result.text))
        return {field: data.get(field, []) for field in fields}

    def _validated_items(
        self,
        items: Any,
        valid_ids: set[str],
        field: str,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if not isinstance(items, list):
            return [], [
                {
                    "field": field,
                    "value": "",
                    "reason": "not_a_list",
                    "evidence_ids": [],
                }
            ]

        validated: list[dict[str, Any]] = []
        dropped: list[dict[str, Any]] = []
        seen: set[tuple[str, tuple[str, ...]]] = set()
        for item in items:
            if not isinstance(item, dict):
                dropped.append(
                    {
                        "field": field,
                        "value": "",
                        "reason": "not_an_object",
                        "evidence_ids": [],
                    }
                )
                continue
            value = str(item.get("value", "")).strip()
            raw_evidence_ids = [str(eid) for eid in item.get("evidence_ids", [])]
            evidence_ids = [eid for eid in raw_evidence_ids if eid in valid_ids]
            if not value or not evidence_ids:
                dropped.append(
                    {
                        "field": field,
                        "value": value,
                        "reason": "missing_supported_evidence",
                        "evidence_ids": raw_evidence_ids,
                    }
                )
                continue
            key = (value.lower(), tuple(sorted(evidence_ids)))
            if key in seen:
                dropped.append(
                    {
                        "field": field,
                        "value": value,
                        "reason": "duplicate",
                        "evidence_ids": evidence_ids,
                    }
                )
                continue
            seen.add(key)
            validated.append(
                {
                    "value": value,
                    "confidence": _normalize_confidence(
                        item.get("confidence"),
                        len(evidence_ids),
                    ),
                    "evidence_ids": evidence_ids,
                    "source": "generated",
                }
            )
        return validated, dropped

    def _normalize_generated_row(self, row: dict[str, Any]) -> None:
        fields = row.get("generated_fields") or row.get("fields") or _empty_fields()
        normalized_fields = _empty_fields()
        for field in ALL_FIELDS:
            normalized_fields[field] = self._normalize_items(fields.get(field, []))
        row["generated_fields"] = normalized_fields
        row["fields"] = deepcopy(normalized_fields)
        row.setdefault("dropped_items", [])
        row["quality"] = self._compute_quality(
            normalized_fields,
            row.get("dropped_items", []),
        )
        if row.get("status") != "failed":
            row["status"] = self._status_from_quality(row["quality"])

    def _normalize_items(self, items: Any) -> list[dict[str, Any]]:
        if not isinstance(items, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            value = str(item.get("value", "")).strip()
            if not value:
                continue
            evidence_ids = [str(eid) for eid in item.get("evidence_ids", [])]
            normalized.append(
                {
                    "value": value,
                    "confidence": _normalize_confidence(
                        item.get("confidence"),
                        len(evidence_ids),
                    ),
                    "evidence_ids": evidence_ids,
                    "source": item.get("source") or "generated",
                }
            )
        return normalized

    def _dedupe_fields(
        self,
        fields: dict[str, list[dict[str, Any]]],
    ) -> dict[str, list[dict[str, Any]]]:
        deduped = _empty_fields()
        for field, items in fields.items():
            seen: set[str] = set()
            for item in self._normalize_items(items):
                key = item["value"].casefold()
                if key in seen:
                    continue
                seen.add(key)
                deduped[field].append(item)
        return deduped

    def _compute_quality(
        self,
        fields: dict[str, list[dict[str, Any]]],
        dropped_items: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        confidence_counts = {"high": 0, "medium": 0, "low": 0}
        field_quality: dict[str, dict[str, Any]] = {}
        supporting_contexts: set[str] = set()

        for field in ALL_FIELDS:
            items = fields.get(field, [])
            field_counts = {"high": 0, "medium": 0, "low": 0}
            field_contexts: set[str] = set()
            for item in items:
                confidence = _normalize_confidence(
                    item.get("confidence"),
                    len(item.get("evidence_ids", [])),
                )
                field_counts[confidence] += 1
                confidence_counts[confidence] += 1
                for evidence_id in item.get("evidence_ids", []):
                    field_contexts.add(str(evidence_id))
                    supporting_contexts.add(str(evidence_id))

            field_quality[field] = {
                "item_count": len(items),
                "confidence_counts": field_counts,
                "supporting_context_count": len(field_contexts),
                "missing": len(items) == 0,
                "verified": False,
            }

        missing_key_categories = [
            field for field in KEY_FIELDS if len(fields.get(field, [])) == 0
        ]
        missing_groups = [
            group
            for group, group_fields in FIELD_GROUPS.items()
            if not any(fields.get(field) for field in group_fields)
        ]

        return {
            "confidence_counts": confidence_counts,
            "field_quality": field_quality,
            "supporting_context_count": len(supporting_contexts),
            "missing_key_categories": missing_key_categories,
            "missing_groups": missing_groups,
            "dropped_unsupported_count": len(dropped_items or []),
            "needs_review": bool(
                confidence_counts["low"]
                or missing_groups
                or dropped_items
            ),
        }

    def _status_from_quality(self, quality: dict[str, Any]) -> str:
        total = sum(quality.get("confidence_counts", {}).values())
        if total == 0:
            return "partial"
        if quality.get("needs_review"):
            return "needs_review"
        return "complete"

    def _default_curation(self) -> dict[str, Any]:
        return {
            "notes": "",
            "row_verified": False,
            "verified_fields": [],
            "curated_fields": {},
            "updated_at": None,
        }

    def _row_with_curation(
        self,
        row: dict[str, Any],
        overrides: dict[str, Any],
    ) -> dict[str, Any]:
        output = deepcopy(row)
        self._normalize_generated_row(output)
        file_location = output.get("paper", {}).get("file_location")
        override = deepcopy(
            overrides.get("rows", {}).get(file_location, self._default_curation())
        )
        curation = {**self._default_curation(), **override}

        effective_fields = deepcopy(output["generated_fields"])
        curated_fields = curation.get("curated_fields", {})
        if isinstance(curated_fields, dict):
            for field, items in curated_fields.items():
                if field in ALL_FIELDS:
                    effective_fields[field] = [
                        {**item, "source": "curated"}
                        for item in self._normalize_items(items)
                    ]

        quality = self._compute_quality(
            effective_fields,
            output.get("dropped_items", []),
        )
        for field in curation.get("verified_fields", []):
            if field in quality["field_quality"]:
                quality["field_quality"][field]["verified"] = True

        output["fields"] = effective_fields
        output["quality"] = quality
        output["curation"] = curation
        if output.get("status") != "failed":
            output["status"] = (
                "verified"
                if curation.get("row_verified")
                else self._status_from_quality(quality)
            )
        return output

    async def update_row_curation(
        self,
        file_location: str,
        patch: dict[str, Any],
    ) -> dict[str, Any]:
        store = self.load_store()
        row = next(
            (
                candidate
                for candidate in store.get("rows", [])
                if candidate.get("paper", {}).get("file_location") == file_location
            ),
            None,
        )
        if row is None:
            raise KeyError(file_location)

        overrides = self.load_overrides()
        row_overrides = overrides.setdefault("rows", {}).setdefault(
            file_location,
            self._default_curation(),
        )

        if "notes" in patch:
            row_overrides["notes"] = str(patch.get("notes") or "")

        if "row_verified" in patch:
            row_overrides["row_verified"] = bool(patch["row_verified"])

        if "verified_fields" in patch:
            row_overrides["verified_fields"] = [
                field for field in patch.get("verified_fields", []) if field in ALL_FIELDS
            ]

        curated_fields = row_overrides.setdefault("curated_fields", {})
        for field, items in (patch.get("curated_fields") or {}).items():
            if field not in ALL_FIELDS:
                continue
            curated_fields[field] = [
                {**item, "source": "curated"}
                for item in self._normalize_items(items)
            ]

        for field in patch.get("clear_curated_fields") or []:
            curated_fields.pop(field, None)

        row_overrides["updated_at"] = _now_iso()
        self.save_overrides(overrides)
        return self._row_with_curation(row, overrides)

    async def verify_row(
        self,
        file_location: str,
        verified: bool = True,
        field: str | None = None,
    ) -> dict[str, Any]:
        store = self.load_store()
        row = next(
            (
                candidate
                for candidate in store.get("rows", [])
                if candidate.get("paper", {}).get("file_location") == file_location
            ),
            None,
        )
        if row is None:
            raise KeyError(file_location)

        overrides = self.load_overrides()
        row_overrides = overrides.setdefault("rows", {}).setdefault(
            file_location,
            self._default_curation(),
        )
        if field:
            if field not in ALL_FIELDS:
                raise ValueError(f"Unknown matrix field: {field}")
            verified_fields = set(row_overrides.get("verified_fields", []))
            if verified:
                verified_fields.add(field)
            else:
                verified_fields.discard(field)
            row_overrides["verified_fields"] = sorted(verified_fields)
        else:
            row_overrides["row_verified"] = verified

        row_overrides["updated_at"] = _now_iso()
        self.save_overrides(overrides)
        return self._row_with_curation(row, overrides)

    def _failed_row(
        self,
        paper: dict[str, Any],
        index_config_hash: str,
        error: str,
    ) -> dict[str, Any]:
        return {
            "paper": paper,
            "generated_fields": _empty_fields(),
            "fields": _empty_fields(),
            "contexts": [],
            "status": "failed",
            "error": error,
            "quality": self._compute_quality(_empty_fields(), []),
            "dropped_items": [],
            "updated_at": _now_iso(),
            "index_config_hash": index_config_hash,
        }


_analysis_service: EvidenceMatrixService | None = None


def get_analysis_service() -> EvidenceMatrixService:
    global _analysis_service
    if _analysis_service is None:
        _analysis_service = EvidenceMatrixService()
    return _analysis_service
