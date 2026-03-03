"""QA Service — wraps PaperQA2's Docs and agent system.

Handles:
- Document indexing (adding PDFs to the collection)
- Question answering with citations
- Streaming status updates via callbacks
"""

from __future__ import annotations

import asyncio
import logging
import pathlib
import pickle
from dataclasses import dataclass, field
from typing import Any, Callable

from paperqa import Docs, Settings
from paperqa.agents.main import agent_query
from paperqa.agents.search import get_directory_index
from paperqa.types import PQASession

from .config import get_papers_dir, get_settings

# Where we persist the Docs index between restarts
_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
DOCS_CACHE_PATH = _PROJECT_ROOT / "data" / "docs_cache.pkl"

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

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "question": self.question,
            "contexts": self.contexts,
            "cost": self.cost,
            "token_counts": self.token_counts,
            "session_id": self.session_id,
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
        self._docs: Docs | None = None
        self._index_built = False

    @property
    def settings(self) -> Settings:
        if self._settings is None:
            self._settings = get_settings()
        return self._settings

    @property
    def docs(self) -> Docs:
        if self._docs is None:
            self._docs = self._load_docs()
        return self._docs

    def _load_docs(self) -> Docs:
        """Load Docs from disk cache, or create fresh if none exists."""
        if DOCS_CACHE_PATH.exists():
            try:
                with open(DOCS_CACHE_PATH, "rb") as f:
                    docs = pickle.load(f)
                n = len(docs.docs)
                logger.info(f"Loaded docs cache: {n} papers already indexed")
                self._index_built = n > 0
                return docs
            except Exception as e:
                logger.warning(f"Could not load docs cache ({e}), starting fresh")
        return Docs()

    def _save_docs(self) -> None:
        """Persist Docs to disk so index survives restarts."""
        try:
            DOCS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
            with open(DOCS_CACHE_PATH, "wb") as f:
                pickle.dump(self._docs, f)
            logger.info(f"Saved docs cache: {len(self._docs.docs)} papers")
        except Exception as e:
            logger.warning(f"Could not save docs cache: {e}")

    def reload_settings(self) -> None:
        """Reload settings from config (e.g. after user changes models)."""
        self._settings = get_settings()
        # Reset docs to pick up new embedding model
        self._docs = None
        self._index_built = False

    def _get_filtered_docs(self, paper_filter: list[str] | None) -> Docs:
        """Return a Docs object filtered to only the specified papers.

        If paper_filter is None or empty, returns the full docs.
        """
        if not paper_filter:
            return self.docs

        # Build a shallow copy of Docs with only matching papers + texts
        filtered = Docs()
        filter_lower = {f.lower() for f in paper_filter}

        for dockey, doc in self.docs.docs.items():
            if doc.docname.lower() in filter_lower:
                filtered.docs[dockey] = doc

        # Copy only texts belonging to filtered docs
        filtered_dockeys = set(filtered.docs.keys())
        for text in self.docs.texts:
            if hasattr(text, "doc") and hasattr(text.doc, "dockey"):
                if text.doc.dockey in filtered_dockeys:
                    filtered.texts.append(text)

        # Copy the texts_index if available
        if hasattr(self.docs, "texts_index") and self.docs.texts_index is not None:
            filtered.texts_index = self.docs.texts_index

        logger.info(
            f"Filtered docs: {len(filtered.docs)} papers, "
            f"{len(filtered.texts)} texts (from filter: {paper_filter})"
        )
        return filtered

    async def index_papers(
        self,
        papers_dir: pathlib.Path | None = None,
        on_status: Callable[[QAStatus], Any] | None = None,
    ) -> list[str]:
        """Index all PDFs in the papers directory.

        Args:
            papers_dir: Directory containing PDFs. Defaults to configured dir.
            on_status: Optional callback for progress updates.

        Returns:
            List of indexed document names.
        """
        if papers_dir is None:
            papers_dir = get_papers_dir()

        pdf_files = sorted(papers_dir.glob("*.pdf"))
        if not pdf_files:
            logger.warning(f"No PDFs found in {papers_dir}")
            return []

        # Get already-indexed doc names to skip them.
        # PaperQA2 generates docnames like "fregel2018ancientgenomesfrom"
        # while filenames are like "Fregel2018.pdf", so we normalize both
        # to lowercase and check if any docname starts with the file stem.
        already_indexed = {doc.docname.lower() for doc in self.docs.docs.values()}

        def _is_already_indexed(pdf_stem: str) -> bool:
            stem_lower = pdf_stem.lower()
            # Exact match (stem or full name)
            if stem_lower in already_indexed or f"{stem_lower}.pdf" in already_indexed:
                return True
            # PaperQA2 docname starts with the stem (e.g. "fregel2018..." starts with "fregel2018")
            if any(dn.startswith(stem_lower) for dn in already_indexed):
                return True
            # Stem starts with a docname (covers edge cases)
            if any(stem_lower.startswith(dn) for dn in already_indexed):
                return True
            return False

        total = len(pdf_files)
        indexed: list[str] = []

        for i, pdf_path in enumerate(pdf_files):
            # Skip if already in index
            if _is_already_indexed(pdf_path.stem):
                logger.info(f"Skipping (already indexed): {pdf_path.name}")
                indexed.append(pdf_path.stem)
                continue
            if on_status:
                on_status(
                    QAStatus(
                        stage="indexing",
                        message=f"Indexing {pdf_path.name} ({i + 1}/{total})",
                        progress=(i / total),
                    )
                )

            try:
                await self.docs.aadd(
                    pdf_path,
                    settings=self.settings,
                )
                indexed.append(pdf_path.stem)
                logger.info(f"Indexed: {pdf_path.name}")
                self._save_docs()  # Save after each PDF — survive interruptions
            except Exception:
                logger.exception(f"Failed to index {pdf_path.name}")

        self._index_built = True

        if on_status:
            on_status(
                QAStatus(
                    stage="done",
                    message=f"Indexed {len(indexed)}/{total} papers",
                    progress=1.0,
                )
            )

        return indexed

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
        docs = self._get_filtered_docs(paper_filter)

        if on_status:
            on_status(QAStatus(stage="searching", message="Searching documents..."))

        # Gather evidence
        if on_status:
            on_status(
                QAStatus(stage="gathering", message="Gathering relevant evidence...")
            )

        session = PQASession(question=question)
        session = await docs.aget_evidence(
            session,
            settings=self.settings,
        )

        # Generate answer
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

        return QAResult(
            answer=session.answer,
            question=session.question,
            contexts=[_serialize_context(ctx) for ctx in session.contexts],
            cost=session.cost,
            token_counts=session.token_counts,
            session_id=str(session.id),
        )

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
        docs = self._get_filtered_docs(paper_filter)

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
        )

    def get_indexed_papers(self) -> list[dict[str, Any]]:
        """Return list of currently indexed papers."""
        papers = []
        for dockey, doc in self.docs.docs.items():
            papers.append(
                {
                    "dockey": str(dockey),
                    "docname": doc.docname,
                    "citation": doc.citation,
                }
            )
        return papers

    def get_stats(self) -> dict[str, Any]:
        """Get current service stats."""
        return {
            "num_papers": len(self.docs.docs),
            "num_chunks": len(self.docs.texts),
            "index_built": self._index_built,
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
