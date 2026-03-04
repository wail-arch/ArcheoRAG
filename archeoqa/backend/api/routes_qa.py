"""Q&A API routes — POST /api/ask and WebSocket /api/ws/ask."""

from __future__ import annotations

import asyncio
import json
import logging
import traceback

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..services.qa_service import QAStatus, get_qa_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["qa"])


class AskRequest(BaseModel):
    question: str
    use_agent: bool = False  # If True, uses iterative agent pipeline
    paper_filter: list[str] | None = None  # Optional: limit to these docnames


class AskResponse(BaseModel):
    answer: str
    question: str
    contexts: list[dict]
    cost: float
    session_id: str


@router.post("/ask", response_model=AskResponse)
async def ask_question(request: AskRequest):
    """Ask a question — returns full answer with citations.

    This is the synchronous endpoint. For streaming, use WebSocket.
    """
    service = get_qa_service()

    if request.use_agent:
        result = await service.ask_with_agent(request.question, paper_filter=request.paper_filter)
    else:
        result = await service.ask(request.question, paper_filter=request.paper_filter)

    return AskResponse(
        answer=result.answer,
        question=result.question,
        contexts=result.contexts,
        cost=result.cost,
        session_id=result.session_id,
    )


@router.websocket("/ws/ask")
async def ask_websocket(websocket: WebSocket):
    """WebSocket endpoint for streaming Q&A with status updates.

    Client sends: {"question": "...", "use_agent": false}
    Server sends events:
      {"type": "status", "stage": "...", "message": "...", "progress": 0.5}
      {"type": "answer", "data": {...}}
      {"type": "error", "message": "..."}
    """
    await websocket.accept()

    try:
        while True:
            # Wait for a question from the client
            raw = await websocket.receive_text()
            data = json.loads(raw)
            question = data.get("question", "").strip()
            use_agent = data.get("use_agent", False)
            paper_filter = data.get("paper_filter", None)

            if not question:
                await websocket.send_json(
                    {"type": "error", "message": "Question cannot be empty"}
                )
                continue

            service = get_qa_service()

            # Status callback — sends updates to the WebSocket
            async def send_status(status: QAStatus) -> None:
                await websocket.send_json(
                    {
                        "type": "status",
                        "stage": status.stage,
                        "message": status.message,
                        "progress": status.progress,
                    }
                )

            # Sync wrapper for the async callback
            def on_status(status: QAStatus) -> None:
                asyncio.create_task(send_status(status))

            try:
                if use_agent:
                    result = await service.ask_with_agent(question, on_status=on_status, paper_filter=paper_filter)
                else:
                    result = await service.ask(question, on_status=on_status, paper_filter=paper_filter)

                await websocket.send_json(
                    {
                        "type": "answer",
                        "data": result.to_dict(),
                    }
                )
            except Exception as e:
                logger.exception(f"Error answering question: {question}")
                await websocket.send_json(
                    {
                        "type": "error",
                        "message": str(e),
                        "traceback": traceback.format_exc(),
                    }
                )

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception:
        logger.exception("WebSocket error")
