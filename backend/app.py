"""ArcheoQA — FastAPI backend for archaeology research platform.

Entry point: uvicorn backend.app:app --reload --port 8000
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes_papers import router as papers_router
from .api.routes_qa import router as qa_router
from .api.routes_settings import router as settings_router
from .services.config import get_papers_dir

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("archeoqa")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic."""
    papers_dir = get_papers_dir()
    logger.info(f"ArcheoQA starting up")
    logger.info(f"Papers directory: {papers_dir}")
    logger.info(f"PDFs found: {len(list(papers_dir.glob('*.pdf')))}")
    yield
    logger.info("ArcheoQA shutting down")


app = FastAPI(
    title="ArcheoQA",
    description="RAG platform for archaeology research — powered by PaperQA2",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite dev server
        "http://localhost:3000",  # Alternative
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routers
app.include_router(qa_router)
app.include_router(papers_router)
app.include_router(settings_router)


@app.get("/")
async def root():
    return {
        "app": "ArcheoQA",
        "version": "0.1.0",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "ok"}
