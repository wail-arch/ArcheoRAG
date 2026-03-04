"""Paper management API routes — upload, list, index, delete PDFs."""

from __future__ import annotations

import asyncio
import json
import logging
import traceback

from fastapi import APIRouter, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..services.paper_service import delete_paper, list_papers, save_uploaded_pdf
from ..services.qa_service import QAStatus, get_qa_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/papers", tags=["papers"])


class IndexResponse(BaseModel):
    indexed: list[str]
    total_papers: int
    total_chunks: int


class PaperInfo(BaseModel):
    filename: str
    path: str
    size_bytes: int
    size_mb: float
    modified: float


@router.get("", response_model=list[PaperInfo])
async def get_papers():
    """List all PDFs in the papers directory."""
    return list_papers()


@router.post("/upload")
async def upload_paper(file: UploadFile):
    """Upload a PDF file to the papers directory."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    saved_path = await save_uploaded_pdf(file.filename, content)

    return {
        "message": f"Uploaded {file.filename}",
        "path": str(saved_path),
        "size_mb": round(len(content) / (1024 * 1024), 2),
    }


@router.post("/index", response_model=IndexResponse)
async def index_papers():
    """Index (or re-index) all PDFs in the papers directory.

    This parses all PDFs, chunks them, computes embeddings,
    and stores them for Q&A.
    """
    service = get_qa_service()
    indexed = await service.index_papers()
    stats = service.get_stats()

    return IndexResponse(
        indexed=indexed,
        total_papers=stats["num_papers"],
        total_chunks=stats["num_chunks"],
    )


@router.get("/indexed")
async def get_indexed_papers():
    """List papers that have been indexed (parsed + embedded)."""
    service = get_qa_service()
    return service.get_indexed_papers()


@router.get("/stats")
async def get_stats():
    """Get indexing stats."""
    service = get_qa_service()
    return service.get_stats()


@router.delete("/{filename}")
async def remove_paper(filename: str):
    """Delete a PDF from the papers directory.

    Note: This removes the file but doesn't remove it from the index.
    Re-index after deletion.
    """
    if not delete_paper(filename):
        raise HTTPException(status_code=404, detail=f"Paper {filename} not found")

    return {"message": f"Deleted {filename}", "note": "Re-index to update the search index"}


@router.websocket("/ws/index")
async def index_websocket(websocket: WebSocket):
    """WebSocket endpoint for indexation with real-time progress.

    Server sends events:
      {"type": "progress", "current": 3, "total": 9, "paper": "Fregel2018.pdf", "stage": "indexing"}
      {"type": "done", "indexed": 9, "total_chunks": 245}
      {"type": "error", "message": "..."}
    """
    await websocket.accept()

    try:
        service = get_qa_service()

        async def send_status(status: QAStatus) -> None:
            if status.stage == "indexing":
                # Parse "Indexing X.pdf (3/9)" from the message
                msg = status.message
                paper = ""
                current = 0
                total = 0
                if "(" in msg and "/" in msg:
                    parts = msg.rsplit("(", 1)
                    paper = parts[0].replace("Indexing ", "").strip()
                    nums = parts[1].rstrip(")").split("/")
                    current = int(nums[0])
                    total = int(nums[1])
                await websocket.send_json({
                    "type": "progress",
                    "current": current,
                    "total": total,
                    "paper": paper,
                    "stage": "indexing",
                })
            elif status.stage == "done":
                pass  # We send our own done message below

        def on_status(status: QAStatus) -> None:
            asyncio.create_task(send_status(status))

        indexed = await service.index_papers(on_status=on_status)
        stats = service.get_stats()

        await websocket.send_json({
            "type": "done",
            "indexed": len(indexed),
            "total_chunks": stats["num_chunks"],
        })
    except WebSocketDisconnect:
        logger.info("Index WebSocket client disconnected")
    except Exception as e:
        logger.exception("Index WebSocket error")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e),
            })
        except Exception:
            pass
