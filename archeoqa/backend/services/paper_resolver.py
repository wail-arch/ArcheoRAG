"""Deterministic paper targeting for Q&A requests.

This layer resolves user references such as "Pereira 2010" or "African Past"
to indexed PaperQA file identifiers before retrieval starts. It deliberately
does not use an LLM: wrong document scope is a retrieval reliability issue, not
a generation task.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Any, Literal


STOPWORDS = {
    "a",
    "an",
    "and",
    "article",
    "au",
    "aux",
    "avec",
    "ce",
    "ces",
    "de",
    "des",
    "du",
    "el",
    "en",
    "et",
    "for",
    "from",
    "in",
    "la",
    "le",
    "les",
    "of",
    "on",
    "paper",
    "papers",
    "papier",
    "papiers",
    "sur",
    "the",
    "to",
    "un",
    "une",
}

TARGETING_TERMS = {
    "compare",
    "comparer",
    "comparez",
    "uniquement",
    "seulement",
    "only",
    "versus",
    " vs ",
    "dans",
    "between",
    "entre",
}


def normalize_text(value: str) -> str:
    """Normalize user/catalog text for stable matching."""
    text = unicodedata.normalize("NFKD", value or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def compact_text(value: str) -> str:
    return normalize_text(value).replace(" ", "")


def _year_from_text(*values: str | None) -> int | None:
    for value in values:
        if not value:
            continue
        match = re.search(r"\b((?:19|20)\d{2})\b", value)
        if match:
            return int(match.group(1))
    return None


def _docname_author_year(docname: str) -> tuple[str | None, int | None]:
    match = re.match(r"^([a-zA-Z]+)((?:19|20)\d{2})", docname or "")
    if not match:
        return None, None
    return match.group(1), int(match.group(2))


def _citation_first_author(citation: str) -> str:
    """Return a best-effort first-author string from a citation."""
    citation = citation or ""
    comma_pos = citation.find(",")
    period_pos = citation.find(".")
    if comma_pos >= 0 and (period_pos < 0 or comma_pos < period_pos):
        return citation[:comma_pos].strip()
    if period_pos >= 0:
        period_prefix = citation[:period_pos].strip()
        prefix_parts = period_prefix.split()
        # Prefer a sentence-ending period for citations like "Jacques François. ...",
        # but avoid stopping on middle initials like "Mary E. Prendergast, ...".
        if prefix_parts and not (
            len(prefix_parts[-1]) == 1 and prefix_parts[-1].isalpha()
        ):
            return period_prefix
    if comma_pos >= 0:
        first_author = citation[:comma_pos]
    elif period_pos >= 0:
        first_author = citation[:period_pos]
    else:
        first_author = citation
    return first_author.strip()


def _citation_author_tokens(citation: str) -> list[str]:
    """Return normalized first-author name tokens from a citation string."""
    return _significant_tokens(_citation_first_author(citation))


def _significant_tokens(value: str) -> list[str]:
    return [
        token
        for token in normalize_text(value).split()
        if len(token) >= 3 and token not in STOPWORDS and not token.isdigit()
    ]


@dataclass(frozen=True)
class PaperRecord:
    file_location: str
    filename: str
    dockey: str
    docname: str
    citation: str
    title: str | None
    year: int | None
    label: str
    aliases: set[str] = field(default_factory=set)
    compact_aliases: set[str] = field(default_factory=set)

    def to_public(self) -> dict[str, Any]:
        return {
            "file_location": self.file_location,
            "filename": self.filename,
            "dockey": self.dockey,
            "docname": self.docname,
            "citation": self.citation,
            "title": self.title,
            "year": self.year,
            "label": self.label,
        }


@dataclass
class TargetingResult:
    mode: Literal["manual_filter", "auto_resolved", "needs_clarification", "global"]
    resolved_papers: list[dict[str, Any]] = field(default_factory=list)
    unresolved_mentions: list[str] = field(default_factory=list)
    candidates: dict[str, list[dict[str, Any]]] = field(default_factory=dict)
    effective_filter: list[str] | None = None

    def to_public(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "resolved_papers": self.resolved_papers,
            "unresolved_mentions": self.unresolved_mentions,
            "candidates": self.candidates,
        }


class PaperResolver:
    """Resolve explicit paper mentions against indexed PaperQA metadata."""

    def __init__(self, indexed_papers: list[dict[str, Any]]) -> None:
        self.records = [self._record_from_paper(paper) for paper in indexed_papers]
        self.alias_map = self._build_alias_map()
        self.compact_alias_map = self._build_compact_alias_map()

    def resolve(
        self, question: str, manual_filter: list[str] | None = None
    ) -> TargetingResult:
        """Return document targeting metadata and an optional effective filter."""
        if manual_filter:
            resolved = self._resolve_manual_filter(manual_filter)
            return TargetingResult(
                mode="manual_filter",
                resolved_papers=[record.to_public() for record in resolved],
                effective_filter=manual_filter,
            )

        normalized_question = normalize_text(question)
        direct_matches = self._resolve_direct_mentions(question)
        if not direct_matches and not self._question_may_target_papers(normalized_question):
            return TargetingResult(mode="global")

        mention_segments = self._extract_target_segments(question)
        segment_matches = self._resolve_segments(mention_segments)

        resolved_by_file: dict[str, PaperRecord] = {}
        segment_order_by_file: dict[str, int] = {}
        unresolved: list[str] = []
        candidates: dict[str, list[dict[str, Any]]] = {}

        for record in direct_matches:
            resolved_by_file[record.file_location] = record

        for segment_index, (segment, records) in enumerate(segment_matches):
            if len(records) == 1:
                resolved_by_file[records[0].file_location] = records[0]
                segment_order_by_file.setdefault(records[0].file_location, segment_index)
            elif len(records) > 1:
                unresolved.append(segment)
                candidates[segment] = [record.to_public() for record in records[:5]]
            elif self._segment_has_hard_reference(segment) or resolved_by_file:
                unresolved.append(segment)
                candidates[segment] = self._candidate_suggestions(segment)

        if unresolved:
            resolved = self._sort_records_for_question(
                list(resolved_by_file.values()),
                question,
                mention_segments,
                segment_order_by_file,
            )
            return TargetingResult(
                mode="needs_clarification",
                resolved_papers=[record.to_public() for record in resolved],
                unresolved_mentions=_dedupe_preserve_order(unresolved),
                candidates=candidates,
            )

        if resolved_by_file:
            resolved = self._sort_records_for_question(
                list(resolved_by_file.values()),
                question,
                mention_segments,
                segment_order_by_file,
            )
            return TargetingResult(
                mode="auto_resolved",
                resolved_papers=[record.to_public() for record in resolved],
                effective_filter=[record.file_location for record in resolved],
            )

        return TargetingResult(mode="global")

    def _record_from_paper(self, paper: dict[str, Any]) -> PaperRecord:
        file_location = str(paper.get("file_location") or "")
        filename = str(paper.get("filename") or file_location)
        docname = str(paper.get("docname") or "")
        title = paper.get("title")
        citation = str(paper.get("citation") or "")
        doc_author, doc_year = _docname_author_year(docname)
        year = paper.get("year") or doc_year or _year_from_text(filename, title, citation)

        aliases: set[str] = set()
        compact_aliases: set[str] = set()

        for value in (file_location, filename, filename.removesuffix(".pdf"), docname, title or ""):
            normalized = normalize_text(str(value))
            if normalized:
                aliases.add(normalized)
            compact = compact_text(str(value))
            if compact:
                compact_aliases.add(compact)

        if doc_author and year:
            author_year = normalize_text(f"{doc_author} {year}")
            aliases.add(author_year)
            compact_aliases.add(author_year.replace(" ", ""))

        label = self._label(
            filename=filename,
            docname=docname,
            title=title,
            year=year,
            citation=citation,
        )
        author_tokens = _citation_author_tokens(citation)
        if year:
            for token in author_tokens:
                author_year = normalize_text(f"{token} {year}")
                aliases.add(author_year)
                compact_aliases.add(author_year.replace(" ", ""))
            if len(author_tokens) >= 2:
                full_author_year = normalize_text(f"{' '.join(author_tokens)} {year}")
                aliases.add(full_author_year)
                compact_aliases.add(full_author_year.replace(" ", ""))

        return PaperRecord(
            file_location=file_location,
            filename=filename,
            dockey=str(paper.get("dockey") or ""),
            docname=docname,
            citation=citation,
            title=str(title) if title else None,
            year=year,
            label=label,
            aliases=aliases,
            compact_aliases=compact_aliases,
        )

    def _label(
        self,
        filename: str,
        docname: str,
        title: str | None,
        year: int | None,
        citation: str,
    ) -> str:
        citation_author = _citation_first_author(citation)
        if citation_author and year:
            author_parts = [part for part in re.split(r"\s+", citation_author) if part]
            if author_parts:
                return f"{author_parts[-1]} {year}"

        doc_author, doc_year = _docname_author_year(docname)
        if doc_author and (year or doc_year):
            return f"{doc_author.capitalize()} {year or doc_year}"
        if title:
            return f"{title}{f' ({year})' if year else ''}"
        return filename

    def _build_alias_map(self) -> dict[str, list[PaperRecord]]:
        alias_map: dict[str, list[PaperRecord]] = {}
        phrase_counts: dict[str, int] = {}
        phrase_owner: dict[str, PaperRecord] = {}

        for record in self.records:
            for alias in record.aliases:
                alias_map.setdefault(alias, []).append(record)

            phrase_source = record.title or record.filename
            tokens = _significant_tokens(phrase_source)
            for size in range(2, min(5, len(tokens)) + 1):
                for idx in range(0, len(tokens) - size + 1):
                    phrase = " ".join(tokens[idx : idx + size])
                    if len(phrase) < 8:
                        continue
                    phrase_counts[phrase] = phrase_counts.get(phrase, 0) + 1
                    phrase_owner[phrase] = record

        for phrase, count in phrase_counts.items():
            if count == 1:
                alias_map.setdefault(phrase, []).append(phrase_owner[phrase])

        return alias_map

    def _build_compact_alias_map(self) -> dict[str, list[PaperRecord]]:
        alias_map: dict[str, list[PaperRecord]] = {}
        for record in self.records:
            for alias in record.compact_aliases:
                alias_map.setdefault(alias, []).append(record)
        return alias_map

    def _resolve_manual_filter(self, manual_filter: list[str]) -> list[PaperRecord]:
        resolved_by_file: dict[str, PaperRecord] = {}
        for item in manual_filter:
            filters = {normalize_text(item), compact_text(item)}
            for record in self.records:
                tokens = (
                    {normalize_text(record.file_location), normalize_text(record.filename), normalize_text(record.docname)}
                    | {compact_text(record.file_location), compact_text(record.filename), compact_text(record.docname)}
                )
                if filters & tokens:
                    resolved_by_file.setdefault(record.file_location, record)
                    break
        resolved = list(resolved_by_file.values())
        return resolved

    def _question_may_target_papers(self, normalized_question: str) -> bool:
        if any(term.strip() in normalized_question for term in TARGETING_TERMS if term.strip()):
            return True
        return bool(
            re.search(r"\b[a-z]{3,}\s+(?:19|20)\d{2}\b", normalized_question)
            or re.search(r"\b[a-z]{3,}(?:19|20)\d{2}\b", normalized_question)
        )

    def _extract_target_segments(self, question: str) -> list[str]:
        normalized = normalize_text(question)
        segments: list[str] = []

        author_year_mentions = re.findall(
            r"\b([a-z][a-z0-9]{2,}\s+(?:19|20)\d{2})\b", normalized
        )
        segments.extend(author_year_mentions)

        compare_match = re.search(
            r"\b(?:compare|comparer|comparez)\s+(.+?)(?:\buniquement\b|\bonly\b|:|\?|$)",
            question,
            flags=re.IGNORECASE,
        )
        if compare_match:
            segments.extend(self._split_reference_list(compare_match.group(1)))

        dans_match = re.search(
            r"\b(?:dans|in|between|entre)\s+(.+?)(?:,|:|\?|$)",
            question,
            flags=re.IGNORECASE,
        )
        if dans_match:
            segments.extend(self._split_reference_list(dans_match.group(1)))

        cleaned_segments = [
            segment.strip(" .;:()[]{}\"'’“”")
            for segment in segments
            if segment and segment.strip()
        ]

        def segment_position(segment: str) -> int:
            found = normalized.find(normalize_text(segment))
            return found if found >= 0 else 10_000

        return _dedupe_preserve_order(
            sorted(cleaned_segments, key=segment_position)
        )

    def _split_reference_list(self, value: str) -> list[str]:
        cleaned = re.sub(
            r"\b(?:ces|deux|trois|papiers|papers|articles|uniquement|only)\b",
            " ",
            value,
            flags=re.IGNORECASE,
        )
        parts = re.split(
            r"\s+(?:et|and|vs|versus)\s+|[,;+/]",
            cleaned,
            flags=re.IGNORECASE,
        )
        return [part.strip() for part in parts if part.strip()]

    def _resolve_segments(self, segments: list[str]) -> list[tuple[str, list[PaperRecord]]]:
        results: list[tuple[str, list[PaperRecord]]] = []
        for segment in segments:
            records = self._match_segment(segment)
            results.append((segment, records))
        return results

    def _resolve_direct_mentions(self, question: str) -> list[PaperRecord]:
        normalized_question = f" {normalize_text(question)} "
        compact_question = compact_text(question)
        records: dict[str, PaperRecord] = {}

        for alias, matches in self.alias_map.items():
            if len(matches) == 1 and len(alias) >= 8 and f" {alias} " in normalized_question:
                records[matches[0].file_location] = matches[0]

        for alias, matches in self.compact_alias_map.items():
            if len(matches) == 1 and len(alias) >= 8 and alias in compact_question:
                records[matches[0].file_location] = matches[0]

        return list(records.values())

    def _sort_records_for_question(
        self,
        records: list[PaperRecord],
        question: str,
        segments: list[str],
        segment_order_by_file: dict[str, int] | None = None,
    ) -> list[PaperRecord]:
        segment_order_by_file = segment_order_by_file or {}
        segment_positions = {
            normalize_text(segment): index
            for index, segment in enumerate(segments)
        }
        normalized_question = normalize_text(question)
        compact_question = compact_text(question)

        def position(record: PaperRecord) -> tuple[int, int, str]:
            best_segment = segment_order_by_file.get(record.file_location, 10_000)
            best_segment = min(
                best_segment,
                min(
                    (
                        index
                        for alias in record.aliases
                        if (index := segment_positions.get(alias)) is not None
                    ),
                    default=10_000,
                ),
            )
            best_question = 10_000
            for alias in sorted(record.aliases, key=len, reverse=True):
                if len(alias) < 4:
                    continue
                found = normalized_question.find(alias)
                if found >= 0:
                    best_question = min(best_question, found)
            for alias in sorted(record.compact_aliases, key=len, reverse=True):
                if len(alias) < 4:
                    continue
                found = compact_question.find(alias)
                if found >= 0:
                    best_question = min(best_question, found)
            return (best_segment, best_question, record.file_location)

        return sorted(records, key=position)

    def _match_segment(self, segment: str) -> list[PaperRecord]:
        normalized = normalize_text(segment)
        compact = compact_text(segment)
        if not normalized:
            return []

        if normalized in self.alias_map:
            return self.alias_map[normalized]
        if compact in self.compact_alias_map:
            return self.compact_alias_map[compact]

        candidates: dict[str, PaperRecord] = {}
        for alias, records in self.alias_map.items():
            if len(records) == 1 and len(normalized) >= 8 and (
                normalized in alias or alias in normalized
            ):
                candidates[records[0].file_location] = records[0]
        return list(candidates.values())

    def _segment_has_hard_reference(self, segment: str) -> bool:
        normalized = normalize_text(segment)
        return bool(re.search(r"\b(?:19|20)\d{2}\b", normalized))

    def _candidate_suggestions(self, segment: str) -> list[dict[str, Any]]:
        segment_tokens = set(_significant_tokens(segment))
        if not segment_tokens:
            return []
        segment_year = _year_from_text(segment)
        scored: list[tuple[int, int, PaperRecord]] = []

        def prefix_score(tokens: set[str], weight: int) -> int:
            score = 0
            for segment_token in segment_tokens:
                for token in tokens:
                    if len(segment_token) >= 4 and (
                        token.startswith(segment_token) or segment_token.startswith(token)
                    ):
                        score += weight
                        break
            return score

        for record in self.records:
            doc_author, _ = _docname_author_year(record.docname)
            author_tokens = set(_citation_author_tokens(record.citation))
            if doc_author:
                author_tokens.add(normalize_text(doc_author))
            label_tokens = set(_significant_tokens(record.label))
            title_tokens = set(
                _significant_tokens(
                    " ".join([record.title or "", record.filename, record.docname])
                )
            )

            year_score = 0
            if segment_year and record.year:
                year_score = 3 if int(record.year) == segment_year else -2

            author_score = len(segment_tokens & author_tokens) * 12 + prefix_score(
                author_tokens, 10
            )
            label_score = len(segment_tokens & label_tokens) * 6 + prefix_score(
                label_tokens, 4
            )
            title_score = len(segment_tokens & title_tokens) * 3 + prefix_score(
                title_tokens, 2
            )

            if segment_year:
                base_score = author_score + label_score + max(title_score - 2, 0)
                if base_score <= 0:
                    continue
                score = base_score + year_score
            else:
                score = author_score + label_score + title_score
            if score > 0:
                scored.append((score, year_score, record))
        scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
        return [record.to_public() for _, _, record in scored[:5]]


def _dedupe_preserve_order(values: Any) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value).strip()
        key = normalize_text(text)
        if not text or not key or key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result
