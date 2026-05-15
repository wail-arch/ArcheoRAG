"""QA Service — wraps PaperQA2's Docs and agent system.

Handles:
- Document indexing (adding PDFs to the collection)
- Question answering with citations
- Streaming status updates via callbacks
"""

from __future__ import annotations

import gc
import hashlib
import json
import logging
import pathlib
import re
import shutil
from dataclasses import dataclass, field
from typing import Any, Callable

from paperqa import Docs, Settings
from paperqa.agents.main import agent_query
from paperqa.agents.search import (
    FAILED_DOCUMENT_ADD_ID,
    SearchIndex,
    get_directory_index,
    reap_opened_index_cache,
)
from paperqa.types import PQASession
from paperqa.version import __version__ as PAPERQA_VERSION

from .config import get_papers_dir, get_settings
from .paper_resolver import PaperResolver, TargetingResult

_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
INDEX_METADATA_PATH = _PROJECT_ROOT / "data" / "index_metadata.json"
PAPER_MANIFEST_PATH = _PROJECT_ROOT / "data" / "analysis" / "paper_manifest.json"

logger = logging.getLogger(__name__)


@dataclass
class QAStatus:
    """Tracks the current status of a QA operation."""

    stage: str = "idle"  # idle, indexing, searching, gathering, answering, done, error
    message: str = ""
    progress: float = 0.0  # 0.0 to 1.0


@dataclass
class QAResult:
    """Structured result from a QA query."""

    answer: str
    question: str
    contexts: list[dict[str, Any]]
    cost: float
    token_counts: dict[str, list[int]]
    session_id: str
    targeting: dict[str, Any] = field(default_factory=lambda: {"mode": "global"})

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "question": self.question,
            "contexts": self.contexts,
            "cost": self.cost,
            "token_counts": self.token_counts,
            "session_id": self.session_id,
            "targeting": self.targeting,
        }


def _serialize_context(ctx: Any) -> dict[str, Any]:
    """Serialize a PaperQA2 Context object to a dict for the API."""
    return {
        "id": ctx.id if hasattr(ctx, "id") else "",
        "context": ctx.context,
        "score": ctx.score,
        "text": {
            "name": ctx.text.name,
            "text": ctx.text.text[:500],  # Truncate for API response
            "doc": {
                "docname": ctx.text.doc.docname,
                "citation": ctx.text.doc.citation,
            },
        },
    }


class QAService:
    """Main service wrapping PaperQA2 for Q&A operations."""

    def __init__(self) -> None:
        self._settings: Settings | None = None

    @property
    def settings(self) -> Settings:
        if self._settings is None:
            self._settings = get_settings()
        return self._settings

    def reload_settings(self) -> None:
        """Reload settings from config (e.g. after user changes models)."""
        self._settings = get_settings()

    def _search_index(self) -> SearchIndex:
        """Create a handle for the configured PaperQA directory index."""
        index_settings = self.settings.agent.index
        return SearchIndex(
            fields=[*SearchIndex.REQUIRED_FIELDS, "title", "year"],
            index_name=index_settings.name or self.settings.get_index_name(),
            index_directory=index_settings.index_directory,
        )

    def _index_config(self) -> dict[str, Any]:
        """Return the indexing-affecting config persisted beside the index."""
        parsing = self.settings.parsing
        parse_pdf = parsing.parse_pdf
        parse_pdf_name = getattr(parse_pdf, "__module__", "") + "." + getattr(
            parse_pdf, "__name__", str(parse_pdf)
        )
        return {
            "paperqa_version": PAPERQA_VERSION,
            "embedding": self.settings.embedding,
            "embedding_config": self.settings.embedding_config,
            "parse_pdf": parse_pdf_name,
            "chunk_size": getattr(parsing, "chunk_size", None),
            "overlap": getattr(parsing, "overlap", None),
            "reader_config": getattr(parsing, "reader_config", None),
            "multimodal": str(getattr(parsing, "multimodal", "off")),
            "use_doc_details": getattr(parsing, "use_doc_details", None),
            "papers_dir": str(get_papers_dir()),
        }

    def get_index_config_hash(self) -> str:
        """Hash current indexing config so stale indexes can be detected."""
        payload = json.dumps(self._index_config(), sort_keys=True, default=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def _load_index_metadata(self) -> dict[str, Any]:
        if not INDEX_METADATA_PATH.exists():
            return {}
        try:
            with open(INDEX_METADATA_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            logger.exception("Could not read index metadata")
            return {}

    def _save_index_metadata(self) -> None:
        INDEX_METADATA_PATH.parent.mkdir(parents=True, exist_ok=True)
        metadata = {
            "config": self._index_config(),
            "index_config_hash": self.get_index_config_hash(),
        }
        with open(INDEX_METADATA_PATH, "w", encoding="utf-8") as f:
            json.dump(metadata, f, indent=2)

    async def _index_files(self) -> dict[str, str]:
        """Return PaperQA's indexed file map, excluding failed documents."""
        index_files = dict(await self._search_index().index_files)
        return {
            file_location: file_hash
            for file_location, file_hash in index_files.items()
            if file_hash != FAILED_DOCUMENT_ADD_ID
        }

    async def _failed_index_files(self) -> dict[str, str]:
        """Return files PaperQA marked as failed during a previous index run."""
        index_files = dict(await self._search_index().index_files)
        return {
            file_location: file_hash
            for file_location, file_hash in index_files.items()
            if file_hash == FAILED_DOCUMENT_ADD_ID
        }

    async def _clear_failed_index_entries(self, papers_dir: pathlib.Path) -> list[str]:
        """Remove failed markers so incremental indexing can retry those PDFs.

        PaperQA stores failed additions in the managed index as `ERROR`. Its
        normal filecheck treats that as an existing entry, so a later sync skips
        the file instead of retrying it. ArcheoQA's "continue indexing" should
        retry local failed PDFs, while still leaving truly indexed files intact.
        """
        search_index = self._search_index()
        failed_files = dict(await self._failed_index_files())
        retried: list[str] = []

        for file_location in failed_files:
            candidate = papers_dir / file_location
            if candidate.exists() and candidate.is_file():
                await search_index.remove_from_index(file_location)
                retried.append(file_location)

        if retried:
            await search_index.save_index()
            logger.info("Cleared failed PaperQA index entries for retry: %s", retried)

        return retried

    async def is_rebuild_required(self) -> bool:
        """Return True when an existing index was built with stale settings."""
        index_ready = bool(await self._index_files())
        saved_hash = self._load_index_metadata().get("index_config_hash")
        return index_ready and saved_hash != self.get_index_config_hash()

    async def _load_docs_from_index(self, paper_filter: list[str] | None = None) -> Docs:
        """Load saved per-file PaperQA Docs objects into one query Docs object."""
        docs = Docs()
        filters = {item.lower() for item in (paper_filter or [])}

        for file_location in sorted(await self._index_files()):
            file_tokens = {
                file_location.lower(),
                pathlib.Path(file_location).name.lower(),
            }
            should_load = not filters or bool(filters & file_tokens)

            saved = await self._search_index().get_saved_object(file_location)
            if saved is None:
                continue
            if not isinstance(saved, Docs):
                logger.warning("Unexpected saved index object for %s", file_location)
                continue

            doc_tokens = {
                str(doc.docname).lower()
                for doc in saved.docs.values()
            } | {
                str(doc.dockey).lower()
                for doc in saved.docs.values()
            }
            if filters and not should_load and not (filters & doc_tokens):
                continue

            docs.docs.update(saved.docs)
            docs.texts.extend(saved.texts)

        logger.info(
            "Loaded query docs from index: %s papers, %s texts",
            len(docs.docs),
            len(docs.texts),
        )
        return docs

    def _empty_result(
        self,
        question: str,
        message: str,
        targeting: dict[str, Any] | None = None,
    ) -> QAResult:
        session = PQASession(question=question)
        return QAResult(
            answer=message,
            question=question,
            contexts=[],
            cost=0.0,
            token_counts={},
            session_id=str(session.id),
            targeting=targeting or {"mode": "global"},
        )

    async def _resolve_targeting(
        self,
        question: str,
        paper_filter: list[str] | None = None,
    ) -> TargetingResult:
        indexed = await self.get_indexed_papers()
        return PaperResolver(indexed).resolve(question, manual_filter=paper_filter)

    def _clarification_message(self, targeting: TargetingResult) -> str:
        lines = [
            "Je ne lance pas la recherche globale parce que la question semble viser des papiers précis, mais je ne peux pas résoudre toutes les références avec assez de certitude.",
            "",
        ]
        if targeting.resolved_papers:
            labels = ", ".join(
                paper.get("label") or paper.get("docname") or paper.get("filename")
                for paper in targeting.resolved_papers
            )
            lines.append(f"Papiers déjà reconnus : {labels}.")
        if targeting.unresolved_mentions:
            lines.append(
                "Références à clarifier : "
                + ", ".join(targeting.unresolved_mentions)
                + "."
            )
        for mention, candidates in targeting.candidates.items():
            if not candidates:
                continue
            labels = [
                (
                    f"{candidate.get('label')} — {candidate.get('title')}"
                    if candidate.get("label") and candidate.get("title")
                    else candidate.get("label")
                    or candidate.get("title")
                    or candidate.get("filename")
                )
                for candidate in candidates[:3]
            ]
            lines.append(f"Candidats pour « {mention} » : " + "; ".join(labels) + ".")
        lines.append(
            "Sélectionnez les papiers avec le filtre, ou reformulez avec auteur + année / titre exact."
        )
        return "\n".join(lines)

    def _is_targeted_comparison(
        self,
        question: str,
        targeting: TargetingResult,
    ) -> bool:
        """Return whether a targeted request should use the comparison guardrail."""
        if targeting.mode not in {"auto_resolved", "manual_filter"}:
            return False
        if len(targeting.resolved_papers) < 2:
            return False
        normalized = question.lower()
        comparison_markers = (
            "compare",
            "comparer",
            "comparez",
            "comparaison",
            "différence",
            "différences",
            "divergence",
            "divergences",
            "contradiction",
            "contradisent",
            "contredisent",
            "versus",
            " vs ",
            "entre",
        )
        return any(marker in normalized for marker in comparison_markers)

    def _comparison_prompt(
        self,
        question: str,
        targeting: TargetingResult,
        matrix_notes: dict[str, dict[str, Any]] | None = None,
    ) -> str:
        """Wrap the user question with strict comparative-answer instructions."""
        papers = targeting.resolved_papers
        paper_lines = []
        for index, paper in enumerate(papers, start=1):
            label = paper.get("label") or paper.get("docname") or paper.get("filename")
            title = paper.get("title") or paper.get("filename")
            citation = paper.get("citation") or ""
            paper_lines.append(
                f"{index}. {label} — {title}. Citation: {citation}"
            )

        matrix_guidance = self._format_matrix_notes_for_prompt(
            targeting,
            matrix_notes or {},
        )

        return (
            "Question utilisateur originale:\n"
            f"{question}\n\n"
            "Tu es ArcheoRAG. Réponds en français avec une comparaison structurée, "
            "auditable et strictement fondée sur les contextes fournis par PaperQA.\n\n"
            "Papiers autorisés uniquement:\n"
            + "\n".join(paper_lines)
            + matrix_guidance
            + "\n\n"
            "Format obligatoire:\n"
            "1. Commence par un tableau Markdown avec les colonnes: Papier | Hypothèse | Preuves utilisées | Datation/période | Méthodes/données | Limites/incertitudes.\n"
            "2. Ajoute ensuite une courte section \"Divergences\" qui distingue méthode, type de données et interprétation.\n"
            "3. Ajoute une courte section \"Lecture synthétique\" indiquant s'ils se contredisent ou répondent à des niveaux différents, seulement si les contextes le permettent.\n\n"
            "Règles de fiabilité:\n"
            "- N'utilise que les papiers autorisés et les contextes récupérés.\n"
            "- Les notes Matrix, si présentes, sont seulement une checklist d'organisation: elles ne sont pas des sources citables.\n"
            "- Ne reprends une information issue de la Matrix que si elle est aussi documentée dans les contextes PaperQA récupérés; sinon écris \"non documenté dans les contextes\".\n"
            "- Distingue explicitement mtDNA moderne, aDNA ancienne, autosomal, uniparental, archéologie et chrono-stratigraphie quand ces catégories apparaissent.\n"
            "- Pour Pereira 2010 ou tout papier similaire fondé sur mtDNA moderne, présente les conclusions comme une inférence phylogéographique/démographique à partir de lignées actuelles, pas comme une preuve archéologique directe de continuité ou de remplacement.\n"
            "- Si les contextes mentionnent IAM, KEB ou TOR, sépare ces groupes explicitement: IAM = Néolithique ancien marocain, KEB = Néolithique récent marocain, TOR = Néolithique ancien sud-ibérique; n'attribue pas à KEB ce qui concerne IAM, ni inversement.\n"
            "- Si une information n'est pas documentée dans les contextes, écris \"non documenté dans les contextes\".\n"
            "- N'invente pas de consensus, de causalité, ni de contradiction.\n"
            "- Ne mentionne jamais d'identifiants internes comme pqac-*, dockey, chunk id, ou hash technique.\n"
            "- Cite les affirmations avec des références courtes, par exemple \"Pereira 2010 p. 7-8\"; évite de répéter la même citation plusieurs fois dans une même cellule.\n"
        )

    def _per_paper_comparison_question(
        self,
        question: str,
        paper: dict[str, Any],
        matrix_note: dict[str, Any] | None = None,
    ) -> str:
        """Create the evidence-gathering question used for one selected paper."""
        label = paper.get("label") or paper.get("docname") or paper.get("filename")
        title = paper.get("title") or paper.get("filename")
        prompt = (
            "Pour préparer une comparaison entre papiers, extrais uniquement les "
            f"éléments du papier {label} — {title} utiles pour répondre à cette "
            f"question: {question}\n\n"
            "Cherche les hypothèses, preuves, méthodes/données, datations/périodes, "
            "limites/incertitudes et divergences potentielles. Ne réponds pas depuis "
            "tes connaissances générales; résume seulement ce qui est documenté dans "
            "ce papier."
        )
        if matrix_note:
            prompt += (
                "\n\nChecklist Matrix non citable pour orienter la recherche dans ce papier "
                "(ne l'utilise que si les contextes PaperQA confirment):\n"
                + self._format_single_matrix_note(matrix_note)
            )
        return prompt

    def _comparison_context_budget(self, paper_count: int) -> int:
        if paper_count <= 2:
            return 5
        if paper_count == 3:
            return 4
        return 3

    def _load_manifest_rows_by_file(self) -> dict[str, dict[str, Any]]:
        if not PAPER_MANIFEST_PATH.exists():
            return {}
        try:
            with open(PAPER_MANIFEST_PATH, encoding="utf-8") as f:
                manifest = json.load(f)
        except Exception:
            logger.exception("Could not read paper manifest for matrix-assisted compare")
            return {}
        rows = manifest.get("rows", [])
        if not isinstance(rows, list):
            return {}
        return {
            str(row.get("file_location") or ""): row
            for row in rows
            if isinstance(row, dict) and row.get("file_location")
        }

    def _matrix_notes_for_targeting(
        self,
        targeting: TargetingResult,
    ) -> tuple[
        dict[str, dict[str, Any]],
        list[dict[str, Any]],
        list[dict[str, Any]],
    ]:
        manifest_rows = self._load_manifest_rows_by_file()
        notes_by_file: dict[str, dict[str, Any]] = {}
        rows_used: list[dict[str, Any]] = []
        missing: list[dict[str, Any]] = []

        for paper in targeting.resolved_papers:
            file_location = str(paper.get("file_location") or "")
            label = str(paper.get("label") or paper.get("docname") or paper.get("filename"))
            manifest_row = manifest_rows.get(file_location)
            if not manifest_row:
                missing.append(
                    {
                        "label": label,
                        "file_location": file_location,
                        "reason": "manifest_row_missing",
                    }
                )
                continue
            if manifest_row.get("source") != "matrix_derived":
                missing.append(
                    {
                        "label": label,
                        "file_location": file_location,
                        "reason": "matrix_not_available",
                    }
                )
                continue

            note = {
                "label": label,
                "file_location": file_location,
                "paper_kind": manifest_row.get("paper_kind"),
                "method_tags": manifest_row.get("method_tags") or [],
                "regions": manifest_row.get("regions") or [],
                "sites": manifest_row.get("sites") or [],
                "periods": manifest_row.get("periods") or [],
                "date_ranges": manifest_row.get("date_ranges") or [],
                "evidence_types": manifest_row.get("evidence_types") or [],
                "main_claims": manifest_row.get("main_claims") or [],
                "limitations": manifest_row.get("limitations") or [],
                "uncertainties": manifest_row.get("uncertainties") or [],
                "source": manifest_row.get("source"),
            }
            notes_by_file[file_location] = note
            rows_used.append(
                {
                    "label": label,
                    "file_location": file_location,
                    "source": str(manifest_row.get("source") or ""),
                    "paper_kind": str(manifest_row.get("paper_kind") or ""),
                    "method_tags": list(manifest_row.get("method_tags") or []),
                }
            )

        return notes_by_file, rows_used, missing

    def _short_matrix_values(
        self,
        values: Any,
        *,
        max_items: int = 5,
        max_chars: int = 120,
    ) -> list[str]:
        if not isinstance(values, list):
            return []
        shortened: list[str] = []
        for value in values:
            text = str(value).strip()
            if not text:
                continue
            if len(text) > max_chars:
                text = text[: max_chars - 1].rstrip() + "…"
            shortened.append(text)
            if len(shortened) >= max_items:
                break
        return shortened

    def _format_single_matrix_note(self, note: dict[str, Any]) -> str:
        fields = (
            ("Type papier", "paper_kind"),
            ("Tags méthodes", "method_tags"),
            ("Régions", "regions"),
            ("Sites", "sites"),
            ("Périodes", "periods"),
            ("Datations", "date_ranges"),
            ("Types de preuve", "evidence_types"),
            ("Claims", "main_claims"),
            ("Limites", "limitations"),
            ("Incertitudes", "uncertainties"),
        )
        lines: list[str] = []
        for label, key in fields:
            raw = note.get(key)
            values = [str(raw)] if isinstance(raw, str) and raw else self._short_matrix_values(raw)
            if values:
                lines.append(f"- {label}: {', '.join(values)}")
        return "\n".join(lines) if lines else "- Aucune note Matrix exploitable."

    def _format_matrix_notes_for_prompt(
        self,
        targeting: TargetingResult,
        matrix_notes: dict[str, dict[str, Any]],
    ) -> str:
        if not matrix_notes:
            return ""
        sections: list[str] = []
        for paper in targeting.resolved_papers:
            file_location = str(paper.get("file_location") or "")
            note = matrix_notes.get(file_location)
            if not note:
                continue
            label = note.get("label") or paper.get("label") or paper.get("docname")
            sections.append(f"{label}:\n{self._format_single_matrix_note(note)}")
        if not sections:
            return ""
        return (
            "\n\nNotes Matrix disponibles (non citables, à utiliser seulement comme "
            "checklist si les contextes PaperQA confirment):\n"
            + "\n\n".join(sections)
        )

    def _settings_with_evidence_budget(
        self,
        evidence_k: int,
        *,
        answer_max_sources: int | None = None,
    ) -> Settings:
        """Return a per-query settings copy with a temporary evidence budget."""
        settings = self.settings.model_copy(deep=True)
        settings.answer.evidence_k = evidence_k
        settings.answer.answer_max_sources = max(
            settings.answer.answer_max_sources,
            answer_max_sources or evidence_k,
        )
        return settings

    def _merge_token_counts(
        self,
        base: dict[str, list[int]],
        extra: dict[str, list[int]],
    ) -> dict[str, list[int]]:
        merged = {model: values[:] for model, values in base.items()}
        for model, values in extra.items():
            if model not in merged:
                merged[model] = values[:]
            else:
                merged[model][0] += values[0]
                merged[model][1] += values[1]
        return merged

    def _dedupe_context_objects(self, contexts: list[Any]) -> list[Any]:
        seen: set[tuple[str, str]] = set()
        deduped: list[Any] = []
        for ctx in contexts:
            key = (
                str(getattr(ctx.text.doc, "docname", "")),
                str(getattr(ctx.text, "name", "")),
            )
            if key in seen:
                continue
            seen.add(key)
            deduped.append(ctx)
        return deduped

    def _context_quality_penalty(self, ctx: Any) -> int:
        """Score contexts that look like bibliography/reference pages."""
        text = " ".join(
            [
                str(getattr(ctx, "context", "")),
                str(getattr(getattr(ctx, "text", None), "text", "")),
            ]
        ).lower()
        penalty = 0

        bibliography_markers = (
            "references",
            "bibliography",
            "works cited",
            "références",
            "bibliographie",
            "liste de références",
            "list of references",
            "ne fournit pas de contenu scientifique",
            "ne contient pas de contenu scientifique",
            "ne contient pas d'éléments de contenu scientifique",
            "ne contient pas d’éléments de contenu scientifique",
            "ne contient pas d'elements de contenu scientifique",
            "ne contient pas de résultats",
            "ne contient pas de resultats",
            "ne contient pas de méthodes",
            "ne contient pas de methodes",
            "ne présente pas directement",
            "ne donne pas d'hypothèses",
            "ne donne pas d’hypothèses",
            "ne donne pas d'hypotheses",
            "contient surtout la bibliographie",
            "surtout la bibliographie",
            "informations bibliographiques",
            "métadonnées bibliographiques",
            "metadonnees bibliographiques",
            "essentiellement de métadonnées bibliographiques",
            "essentiellement de metadonnees bibliographiques",
            "surtout des informations bibliographiques",
            "fournit surtout des informations bibliographiques",
            "correspond essentiellement à la bibliographie",
            "aucune information méthodologique",
            "aucune information methodologique",
        )
        substantive_markers = (
            "hypoth",
            "method",
            "méthod",
            "result",
            "résultat",
            "preuve",
            "evidence",
            "datation",
            "période",
            "period",
            "limit",
            "incertitude",
            "discussion",
            "conclu",
            "suggest",
            "propos",
            "admixture",
            "aDNA".lower(),
            "mtdna",
            "autosomal",
            "chronolog",
        )

        penalty += sum(3 for marker in bibliography_markers if marker in text)
        if any(marker in text for marker in bibliography_markers):
            penalty += 2
        penalty += min(len(re.findall(r"\bdoi\b|https?://|www\.", text)), 6)
        penalty += 2 if len(re.findall(r"\b(?:19|20)\d{2}\b", text)) >= 12 else 0
        penalty += 2 if len(re.findall(r"\bet\s+al\.|\bdoi:|\burl:", text)) >= 5 else 0
        score = getattr(ctx, "score", None)
        if isinstance(score, int | float):
            if score <= 1:
                penalty += 4
            elif score <= 3:
                penalty += 2
        penalty -= min(sum(1 for marker in substantive_markers if marker in text), 4)
        return penalty

    def _filter_low_quality_comparison_contexts(
        self,
        contexts: list[Any],
    ) -> tuple[list[Any], list[dict[str, Any]]]:
        """Drop likely bibliography contexts only when safer alternatives exist."""
        by_docname: dict[str, list[Any]] = {}
        for ctx in contexts:
            docname = str(getattr(ctx.text.doc, "docname", ""))
            by_docname.setdefault(docname, []).append(ctx)

        kept: list[Any] = []
        dropped: list[dict[str, Any]] = []
        min_per_paper = 2

        for docname, paper_contexts in by_docname.items():
            if len(paper_contexts) <= min_per_paper:
                kept.extend(paper_contexts)
                continue

            scored = [
                (self._context_quality_penalty(ctx), idx, ctx)
                for idx, ctx in enumerate(paper_contexts)
            ]
            low_quality = [
                item for item in scored if item[0] >= 6
            ]
            keep_ids = {id(ctx) for _, _, ctx in scored}
            removable = max(0, len(paper_contexts) - min_per_paper)

            for penalty, _, ctx in sorted(low_quality, key=lambda item: item[0], reverse=True):
                if removable <= 0:
                    break
                keep_ids.remove(id(ctx))
                removable -= 1
                dropped.append(
                    {
                        "docname": docname,
                        "name": str(getattr(ctx.text, "name", "")),
                        "score": getattr(ctx, "score", None),
                        "quality_penalty": penalty,
                        "reason": "likely_bibliography_or_references",
                    }
                )

            kept.extend([ctx for ctx in paper_contexts if id(ctx) in keep_ids])

        return kept, dropped

    async def _gather_balanced_comparison_contexts(
        self,
        question: str,
        targeting: TargetingResult,
        matrix_notes: dict[str, dict[str, Any]] | None = None,
        on_status: Callable[[QAStatus], Any] | None = None,
    ) -> tuple[
        list[Any],
        dict[str, int],
        list[dict[str, Any]],
        list[dict[str, Any]],
        dict[str, list[int]],
        float,
    ]:
        """Gather PaperQA evidence independently for each targeted paper."""
        papers = targeting.resolved_papers
        per_paper_k = self._comparison_context_budget(len(papers))
        gather_settings = self._settings_with_evidence_budget(per_paper_k)
        contexts: list[Any] = []
        per_paper_counts: dict[str, int] = {}
        partial_papers: list[dict[str, Any]] = []
        token_counts: dict[str, list[int]] = {}
        cost = 0.0

        for index, paper in enumerate(papers, start=1):
            label = str(
                paper.get("label") or paper.get("docname") or paper.get("filename")
            )
            file_location = str(paper.get("file_location") or "")
            if on_status:
                on_status(
                    QAStatus(
                        stage="gathering",
                        message=f"Gathering evidence for {label} ({index}/{len(papers)})",
                        progress=index / max(len(papers), 1),
                    )
                )

            paper_docs = await self._load_docs_from_index([file_location])
            if not paper_docs.docs:
                per_paper_counts[label] = 0
                partial_papers.append(
                    {
                        "label": label,
                        "file_location": file_location,
                        "reason": "paper_not_loaded",
                    }
                )
                continue

            paper_session = PQASession(
                question=self._per_paper_comparison_question(
                    question,
                    paper,
                    (matrix_notes or {}).get(file_location),
                )
            )
            paper_session = await paper_docs.aget_evidence(
                paper_session,
                settings=gather_settings,
            )
            count = len(paper_session.contexts)
            per_paper_counts[label] = count
            contexts.extend(paper_session.contexts)

            if count < max(1, per_paper_k // 2):
                partial_papers.append(
                    {
                        "label": label,
                        "file_location": file_location,
                        "reason": "low_context_count",
                        "context_count": count,
                    }
                )

            token_counts = self._merge_token_counts(
                token_counts,
                paper_session.token_counts,
            )
            cost += paper_session.cost

        deduped_contexts = self._dedupe_context_objects(contexts)
        filtered_contexts, dropped_low_quality = (
            self._filter_low_quality_comparison_contexts(deduped_contexts)
        )

        return (
            filtered_contexts,
            per_paper_counts,
            partial_papers,
            dropped_low_quality,
            token_counts,
            cost,
        )

    def _citation_aliases(self, targeting: TargetingResult) -> dict[str, str]:
        aliases: dict[str, str] = {}
        for paper in targeting.resolved_papers:
            docname = str(paper.get("docname") or "")
            label = str(paper.get("label") or docname)
            if not docname or not label:
                continue
            aliases[docname] = label
            aliases[docname.lower()] = label
        return aliases

    def _normalize_inline_citations(
        self,
        answer: str,
        targeting: TargetingResult,
    ) -> str:
        """Replace raw PaperQA chunk references with readable short citations."""
        aliases = self._citation_aliases(targeting)
        if not aliases:
            return answer

        cleaned = answer
        for docname, label in sorted(aliases.items(), key=lambda item: len(item[0]), reverse=True):
            escaped = re.escape(docname)
            pattern = rf"\b{escaped}\s+pages?\s+(\d+(?:\s*[-–,]\s*\d+)*)"
            cleaned = re.sub(
                pattern,
                lambda match: f"{label} p. {match.group(1).strip()}",
                cleaned,
                flags=re.IGNORECASE,
            )
        return cleaned

    def _clean_answer_text(self, answer: str, targeting: TargetingResult) -> tuple[str, bool]:
        """Remove internal PaperQA identifiers that should not reach the UI."""
        cleaned = self._normalize_inline_citations(answer, targeting)
        patterns = (
            r"\(\s*(?:pqac|pqa|chunk|doc)[-_][A-Za-z0-9_.:-]+\s*\)",
            r"\b(?:pqac|pqa|chunk|doc)[-_][A-Za-z0-9_.:-]+\b",
        )
        for pattern in patterns:
            cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
        cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned)
        cleaned = re.sub(r"\(\s*\)", "", cleaned)
        cleaned = cleaned.strip()
        return cleaned, bool(re.search("|".join(patterns), answer, flags=re.IGNORECASE))

    def _out_of_scope_contexts(
        self,
        contexts: list[dict[str, Any]],
        targeting: TargetingResult,
    ) -> list[dict[str, Any]]:
        """Detect contexts that do not belong to the targeted papers."""
        if targeting.mode not in {"auto_resolved", "manual_filter"}:
            return []
        allowed_docnames = {
            str(paper.get("docname") or "").lower()
            for paper in targeting.resolved_papers
            if paper.get("docname")
        }
        if not allowed_docnames:
            return []
        out_of_scope = []
        for ctx in contexts:
            docname = (
                ctx.get("text", {})
                .get("doc", {})
                .get("docname", "")
            )
            if str(docname).lower() not in allowed_docnames:
                out_of_scope.append(ctx)
        return out_of_scope

    def _targeting_metadata(
        self,
        targeting: TargetingResult,
        *,
        answer_mode: str,
        cleaned_internal_ids: bool,
        out_of_scope_contexts: list[dict[str, Any]],
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        metadata = targeting.to_public()
        warnings: list[str] = []
        if cleaned_internal_ids:
            warnings.append("internal_ids_removed")
        if out_of_scope_contexts:
            warnings.append("out_of_scope_contexts_detected")
        metadata.update(
            {
                "answer_mode": answer_mode,
                "cleaned_internal_ids": cleaned_internal_ids,
                "warnings": warnings,
                "out_of_scope_contexts": [
                    {
                        "docname": ctx.get("text", {})
                        .get("doc", {})
                        .get("docname", ""),
                        "name": ctx.get("text", {}).get("name", ""),
                    }
                    for ctx in out_of_scope_contexts
                ],
            }
        )
        if extra:
            metadata.update(extra)
        return metadata

    async def _answer_targeted_comparison_balanced(
        self,
        question: str,
        docs: Docs,
        targeting: TargetingResult,
        on_status: Callable[[QAStatus], Any] | None = None,
    ) -> QAResult:
        """Compare targeted papers after gathering evidence per paper."""
        if on_status:
            on_status(
                QAStatus(
                    stage="gathering",
                    message="Gathering balanced evidence by paper...",
                    progress=0.0,
                )
            )

        matrix_notes, matrix_rows_used, matrix_missing_papers = (
            self._matrix_notes_for_targeting(targeting)
        )
        (
            balanced_contexts,
            per_paper_counts,
            partial_papers,
            dropped_low_quality,
            gather_token_counts,
            gather_cost,
        ) = await self._gather_balanced_comparison_contexts(
            question,
            targeting,
            matrix_notes,
            on_status=on_status,
        )

        if on_status:
            on_status(
                QAStatus(
                    stage="answering",
                    message="Generating balanced comparative answer...",
                    progress=1.0,
                )
            )

        answer_question = self._comparison_prompt(question, targeting, matrix_notes)
        session = PQASession(question=answer_question)
        session.contexts = balanced_contexts
        final_settings = self._settings_with_evidence_budget(
            self.settings.answer.evidence_k,
            answer_max_sources=max(len(balanced_contexts), self.settings.answer.answer_max_sources),
        )
        final_settings.answer.get_evidence_if_no_contexts = False
        session = await docs.aquery(
            session,
            settings=final_settings,
        )
        session.token_counts = self._merge_token_counts(
            gather_token_counts,
            session.token_counts,
        )
        session.cost += gather_cost

        if on_status:
            on_status(QAStatus(stage="done", message="Answer ready"))

        contexts = [_serialize_context(ctx) for ctx in session.contexts]
        answer, cleaned_internal_ids = self._clean_answer_text(session.answer, targeting)
        out_of_scope = self._out_of_scope_contexts(contexts, targeting)
        if out_of_scope:
            allowed_docnames = {
                str(paper.get("docname") or "").lower()
                for paper in targeting.resolved_papers
                if paper.get("docname")
            }
            contexts = [
                ctx
                for ctx in contexts
                if str(
                    ctx.get("text", {})
                    .get("doc", {})
                    .get("docname", "")
                ).lower()
                in allowed_docnames
            ]

        return QAResult(
            answer=answer,
            question=question,
            contexts=contexts,
            cost=session.cost,
            token_counts=session.token_counts,
            session_id=str(session.id),
            targeting=self._targeting_metadata(
                targeting,
                answer_mode="targeted_comparison_balanced",
                cleaned_internal_ids=cleaned_internal_ids,
                out_of_scope_contexts=out_of_scope,
                extra={
                    "comparison_strategy": "per_paper_evidence_then_synthesis",
                    "per_paper_context_counts": per_paper_counts,
                    "partial_papers": partial_papers,
                    "context_quality_filter": "bibliography_reference_heuristic",
                    "dropped_low_quality_contexts": dropped_low_quality,
                    "matrix_assisted": bool(matrix_rows_used),
                    "matrix_assistance_strategy": (
                        "matrix_notes_as_retrieval_and_synthesis_guidance"
                        if matrix_rows_used
                        else None
                    ),
                    "matrix_rows_used": matrix_rows_used,
                    "matrix_missing_papers": matrix_missing_papers,
                },
            ),
        )

    async def _answer_direct(
        self,
        question: str,
        docs: Docs,
        targeting: TargetingResult,
        on_status: Callable[[QAStatus], Any] | None = None,
    ) -> QAResult:
        if on_status:
            on_status(QAStatus(stage="searching", message="Searching documents..."))

        if on_status:
            on_status(
                QAStatus(stage="gathering", message="Gathering relevant evidence...")
            )

        is_targeted_comparison = self._is_targeted_comparison(question, targeting)
        if is_targeted_comparison and 2 <= len(targeting.resolved_papers) <= 5:
            return await self._answer_targeted_comparison_balanced(
                question,
                docs,
                targeting,
                on_status=on_status,
            )

        answer_question = (
            self._comparison_prompt(question, targeting)
            if is_targeted_comparison
            else question
        )

        session = PQASession(question=answer_question)
        session = await docs.aget_evidence(
            session,
            settings=self.settings,
        )

        if on_status:
            on_status(
                QAStatus(stage="answering", message="Generating answer with citations...")
            )

        session = await docs.aquery(
            session,
            settings=self.settings,
        )

        if on_status:
            on_status(QAStatus(stage="done", message="Answer ready"))

        contexts = [_serialize_context(ctx) for ctx in session.contexts]
        answer, cleaned_internal_ids = self._clean_answer_text(session.answer, targeting)
        out_of_scope = self._out_of_scope_contexts(contexts, targeting)
        if out_of_scope:
            allowed_docnames = {
                str(paper.get("docname") or "").lower()
                for paper in targeting.resolved_papers
                if paper.get("docname")
            }
            contexts = [
                ctx
                for ctx in contexts
                if str(
                    ctx.get("text", {})
                    .get("doc", {})
                    .get("docname", "")
                ).lower()
                in allowed_docnames
            ]

        return QAResult(
            answer=answer,
            question=question,
            contexts=contexts,
            cost=session.cost,
            token_counts=session.token_counts,
            session_id=str(session.id),
            targeting=self._targeting_metadata(
                targeting,
                answer_mode=(
                    "targeted_comparison"
                    if is_targeted_comparison
                    else "standard"
                ),
                cleaned_internal_ids=cleaned_internal_ids,
                out_of_scope_contexts=out_of_scope,
            ),
        )

    async def index_papers(
        self,
        papers_dir: pathlib.Path | None = None,
        on_status: Callable[[QAStatus], Any] | None = None,
        allow_stale_config: bool = False,
    ) -> list[str]:
        """Sync the PaperQA directory index with the papers directory.

        Args:
            papers_dir: Directory containing PDFs. Defaults to configured dir.
            on_status: Optional callback for progress updates.

        Returns:
            List of indexed document names.
        """
        if papers_dir is None:
            papers_dir = get_papers_dir()

        if not allow_stale_config and await self.is_rebuild_required():
            raise RuntimeError(
                "Index rebuild required because indexing settings changed."
            )

        pdf_files = sorted(papers_dir.glob("*.pdf"))

        if on_status:
            on_status(
                QAStatus(
                    stage="indexing",
                    message=f"Syncing PaperQA index ({len(pdf_files)} PDFs)",
                    progress=0.0,
                )
            )

        retried_failed = await self._clear_failed_index_entries(papers_dir)
        if retried_failed and on_status:
            on_status(
                QAStatus(
                    stage="indexing",
                    message=f"Retrying {len(retried_failed)} failed PDF(s)",
                    progress=0.0,
                )
            )

        await get_directory_index(settings=self.settings, build=True)
        self._save_index_metadata()
        indexed = await self.get_indexed_papers()

        if on_status:
            on_status(
                QAStatus(
                    stage="done",
                    message=f"Indexed {len(indexed)}/{len(pdf_files)} papers",
                    progress=1.0,
                )
            )

        return [paper["file_location"] for paper in indexed]

    async def rebuild_index(
        self,
        on_status: Callable[[QAStatus], Any] | None = None,
    ) -> list[str]:
        """Delete and rebuild the configured PaperQA index."""
        index_settings = self.settings.agent.index
        index_dir = pathlib.Path(index_settings.index_directory) / (
            index_settings.name or self.settings.get_index_name()
        )
        if index_dir.exists():
            gc.collect()
            reap_opened_index_cache()
            shutil.rmtree(index_dir)
        if INDEX_METADATA_PATH.exists():
            INDEX_METADATA_PATH.unlink()
        return await self.index_papers(
            on_status=on_status,
            allow_stale_config=True,
        )

    async def ask(
        self,
        question: str,
        on_status: Callable[[QAStatus], Any] | None = None,
        paper_filter: list[str] | None = None,
    ) -> QAResult:
        """Ask a question and get an answer with citations.

        Uses PaperQA2's Docs.aquery() for direct Q&A.

        Args:
            question: The question to answer.
            on_status: Optional callback for streaming status updates.

        Returns:
            QAResult with answer, contexts, and metadata.
        """
        if await self.is_rebuild_required():
            return self._empty_result(
                question,
                "L'index doit être reconstruit car la configuration d'indexation a changé.",
            )

        targeting = await self._resolve_targeting(question, paper_filter)
        if targeting.mode == "needs_clarification":
            return self._empty_result(
                question,
                self._clarification_message(targeting),
                targeting=targeting.to_public(),
            )

        docs = await self._load_docs_from_index(targeting.effective_filter)
        if not docs.docs:
            return self._empty_result(
                question,
                "Je ne peux pas répondre: aucun papier indexé ne correspond à cette requête.",
                targeting=targeting.to_public(),
            )

        return await self._answer_direct(question, docs, targeting, on_status=on_status)

    async def ask_with_agent(
        self,
        question: str,
        on_status: Callable[[QAStatus], Any] | None = None,
        paper_filter: list[str] | None = None,
    ) -> QAResult:
        """Ask using the agentic pipeline (search → gather → answer loop).

        Uses PaperQA2's agent_query() for iterative search and evidence gathering.
        This is more thorough but slower than direct ask().

        Args:
            question: The question to answer.
            on_status: Optional callback for streaming status updates.

        Returns:
            QAResult with answer, contexts, and metadata.
        """
        if await self.is_rebuild_required():
            return self._empty_result(
                question,
                "L'index doit être reconstruit car la configuration d'indexation a changé.",
            )

        targeting = await self._resolve_targeting(question, paper_filter)
        if targeting.mode == "needs_clarification":
            return self._empty_result(
                question,
                self._clarification_message(targeting),
                targeting=targeting.to_public(),
            )

        docs = await self._load_docs_from_index(targeting.effective_filter)
        if not docs.docs:
            return self._empty_result(
                question,
                "Je ne peux pas répondre: aucun papier indexé ne correspond à cette requête.",
                targeting=targeting.to_public(),
            )

        if targeting.effective_filter:
            logger.info("Using direct targeted Q&A to keep paper scope isolated")
            return await self._answer_direct(
                question,
                docs,
                targeting,
                on_status=on_status,
            )

        if on_status:
            on_status(
                QAStatus(
                    stage="searching",
                    message="Agent searching and gathering evidence...",
                )
            )

        response = await agent_query(
            question,
            settings=self.settings,
            docs=docs,
        )

        session = response.session

        if on_status:
            on_status(QAStatus(stage="done", message="Answer ready"))

        return QAResult(
            answer=session.answer,
            question=session.question,
            contexts=[_serialize_context(ctx) for ctx in session.contexts],
            cost=session.cost,
            token_counts=session.token_counts,
            session_id=str(session.id),
            targeting=targeting.to_public(),
        )

    async def get_indexed_papers(self) -> list[dict[str, Any]]:
        """Return list of currently indexed papers."""
        papers: list[dict[str, Any]] = []
        for file_location in sorted(await self._index_files()):
            saved = await self._search_index().get_saved_object(file_location)
            if not isinstance(saved, Docs) or not saved.docs:
                continue
            doc = next(iter(saved.docs.values()))
            papers.append(
                {
                    "file_location": file_location,
                    "filename": pathlib.Path(file_location).name,
                    "dockey": str(doc.dockey),
                    "docname": doc.docname,
                    "citation": doc.citation,
                    "title": getattr(doc, "title", None),
                    "year": getattr(doc, "year", None),
                }
            )
        return papers

    async def get_stats(self) -> dict[str, Any]:
        """Get current service stats."""
        indexed = await self.get_indexed_papers()
        query_docs = await self._load_docs_from_index()
        failed_files = sorted((await self._failed_index_files()).keys())
        current_hash = self.get_index_config_hash()
        index_ready = bool(indexed)
        return {
            "num_papers": len(indexed),
            "num_chunks": len(query_docs.texts),
            "index_built": index_ready,
            "index_ready": index_ready,
            "rebuild_required": await self.is_rebuild_required(),
            "indexed_files": [paper["file_location"] for paper in indexed],
            "failed_files": failed_files,
            "index_config_hash": current_hash,
            "papers_dir": str(get_papers_dir()),
        }


# Global singleton
_qa_service: QAService | None = None


def get_qa_service() -> QAService:
    """Get or create the global QA service instance."""
    global _qa_service
    if _qa_service is None:
        _qa_service = QAService()
    return _qa_service
