"""Paper management service — handles PDF upload, listing, deletion."""

from __future__ import annotations

import logging
import pathlib
import shutil
from typing import Any

from .config import get_papers_dir

logger = logging.getLogger(__name__)


def list_papers() -> list[dict[str, Any]]:
    """List all PDFs in the papers directory with metadata."""
    papers_dir = get_papers_dir()
    papers = []

    for pdf_path in sorted(papers_dir.glob("*.pdf")):
        stat = pdf_path.stat()
        papers.append(
            {
                "filename": pdf_path.name,
                "path": str(pdf_path),
                "size_bytes": stat.st_size,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "modified": stat.st_mtime,
            }
        )

    return papers


async def save_uploaded_pdf(filename: str, content: bytes) -> pathlib.Path:
    """Save an uploaded PDF file to the papers directory.

    Args:
        filename: Original filename.
        content: Raw file bytes.

    Returns:
        Path to the saved file.
    """
    papers_dir = get_papers_dir()
    dest = papers_dir / filename

    # Avoid overwriting — append number if exists
    counter = 1
    while dest.exists():
        stem = pathlib.Path(filename).stem
        suffix = pathlib.Path(filename).suffix
        dest = papers_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    dest.write_bytes(content)
    logger.info(f"Saved uploaded PDF: {dest}")
    return dest


def delete_paper(filename: str) -> bool:
    """Delete a PDF from the papers directory.

    Args:
        filename: Name of the PDF file to delete.

    Returns:
        True if deleted, False if not found.
    """
    papers_dir = get_papers_dir()
    pdf_path = papers_dir / filename

    if not pdf_path.exists():
        return False

    pdf_path.unlink()
    logger.info(f"Deleted PDF: {pdf_path}")
    return True


def get_paper_count() -> int:
    """Get number of PDFs in the papers directory."""
    return len(list(get_papers_dir().glob("*.pdf")))
