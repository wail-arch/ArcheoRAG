"""Configuration service for ArcheoQA platform.

Wraps PaperQA2 Settings with the SOTA stack:
- LLM Generator: GPT-5 (OpenAI)
- Summary LLM: GPT-5 (OpenAI)
- Embedding: Qwen3-Embedding-4B (via LiteLLM)
- Enrichment LLM: Gemini 3 Pro Preview (Google AI — OCR + vision)
- PDF Parser: Docling (best quality for tables/figures)
"""

from __future__ import annotations

import json
import os
import pathlib
from typing import Any

import litellm
from dotenv import load_dotenv

# Load .env from project root
_PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
load_dotenv(_PROJECT_ROOT / ".env")

# GPT-5 and other reasoning models don't support all params — drop them silently
litellm.drop_params = True

# PaperQA2 imports
from paperqa.settings import (
    AgentSettings,
    AnswerSettings,
    IndexSettings,
    MaybeSettings,
    MultimodalOptions,
    ParsingSettings,
    PromptSettings,
    Settings,
)

# Default paths
DEFAULT_PAPERS_DIR = _PROJECT_ROOT / "data" / "papers"
SETTINGS_FILE = _PROJECT_ROOT / "data" / "settings.json"


_GPT5_MODELS = {"gpt-5", "gpt-5-codex", "gpt-5-mini"}
_GPT52_MODELS = {"gpt-5.2", "gpt-5.2-pro", "gpt-5.2-codex", "gpt-5.2-2025-12-11"}

# reasoning_effort per model family
_REASONING_EFFORT: dict[str, str] = {}
for _m in _GPT52_MODELS:
    _REASONING_EFFORT[_m] = "medium"
for _m in _GPT5_MODELS:
    _REASONING_EFFORT[_m] = "medium"


def _model_temperature(model: str, requested: float) -> float:
    """GPT-5 (non-.2) requires temp=1. GPT-5.2 supports temp normally."""
    if model in _GPT5_MODELS or (model.startswith("gpt-5") and "." not in model):
        return 1.0
    return requested


def _make_litellm_config(model: str, temperature: float = 0.0) -> dict[str, Any]:
    """Create a LiteLLM Router config for a model."""
    actual_temp = _model_temperature(model, temperature)
    litellm_params: dict[str, Any] = {
        "model": model,
        "temperature": actual_temp,
        "drop_params": True,
    }
    # Add reasoning_effort for GPT-5.x models
    if model in _REASONING_EFFORT or model.startswith("gpt-5"):
        litellm_params["reasoning_effort"] = _REASONING_EFFORT.get(model, "medium")

    return {
        "model_list": [
            {
                "model_name": model,
                "litellm_params": litellm_params,
            }
        ],
    }


def get_papers_dir() -> pathlib.Path:
    """Get the papers directory from env or default."""
    papers_dir = pathlib.Path(
        os.getenv("PAPERS_DIR", str(DEFAULT_PAPERS_DIR))
    ).resolve()
    papers_dir.mkdir(parents=True, exist_ok=True)
    return papers_dir


def get_settings() -> Settings:
    """Create PaperQA2 Settings with the SOTA stack.

    If a saved settings.json exists, loads overrides from it.
    """
    # Load user overrides if they exist
    overrides: dict[str, Any] = {}
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE) as f:
            overrides = json.load(f)

    # Determine model names (allow overrides)
    llm = overrides.get("llm", "gpt-5.2")
    summary_llm = overrides.get("summary_llm", "gpt-5.2")
    embedding = overrides.get("embedding", "text-embedding-3-large")
    enrichment_llm = overrides.get("enrichment_llm", "gemini/gemini-3-pro")
    agent_llm = overrides.get("agent_llm", "gpt-5.2")
    papers_dir = get_papers_dir()

    # Temperature: GPT-5 requires temp=1, others default to 0
    _base_temp = overrides.get("temperature", 0.0)
    temperature = _model_temperature(llm, _base_temp)

    # Enable visual enrichment only if a valid Google key is configured
    _google_key = os.getenv("GOOGLE_API_KEY", "")
    _has_google_key = bool(_google_key) and _google_key not in ("...", "your-key-here", "")
    _multimodal = MultimodalOptions.ON_WITH_ENRICHMENT if _has_google_key else MultimodalOptions.OFF

    settings = Settings(
        llm=llm,
        llm_config=_make_litellm_config(llm, temperature),
        summary_llm=summary_llm,
        summary_llm_config=_make_litellm_config(summary_llm, temperature),
        embedding=embedding,
        embedding_config=overrides.get("embedding_config"),
        temperature=temperature,
        verbosity=overrides.get("verbosity", 1),
        answer=AnswerSettings(
            evidence_k=overrides.get("evidence_k", 10),
            answer_max_sources=overrides.get("answer_max_sources", 5),
            evidence_summary_length=overrides.get(
                "evidence_summary_length", "50 to 100 words"
            ),
            answer_length=overrides.get("answer_length", "200 to 300 words"),
            max_answer_attempts=3,
        ),
        parsing=ParsingSettings(
            use_doc_details=True,
            multimodal=_multimodal,
            enrichment_llm=enrichment_llm if _has_google_key else "gpt-5.2",
            enrichment_llm_config=_make_litellm_config(enrichment_llm, 0.0) if _has_google_key else None,
            # Docling parser — best quality for tables/figures
            parse_pdf="paperqa_docling.parse_pdf_to_pages",
            reader_config={
                "chunk_chars": 5000,
                "overlap": 250,
            },
        ),
        prompts=PromptSettings(
            use_json=True,
        ),
        agent=AgentSettings(
            agent_llm=agent_llm,
            agent_llm_config=_make_litellm_config(agent_llm, temperature),
            max_timesteps=15,
            timeout=120.0,
            index=IndexSettings(
                paper_directory=papers_dir,
            ),
        ),
    )

    return settings


def save_settings_overrides(overrides: dict[str, Any]) -> None:
    """Save user settings overrides to disk."""
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w") as f:
        json.dump(overrides, f, indent=2)


def get_current_config() -> dict[str, Any]:
    """Return current config for the settings API (safe to send to frontend)."""
    settings = get_settings()
    return {
        "llm": settings.llm,
        "summary_llm": settings.summary_llm,
        "embedding": settings.embedding,
        "enrichment_llm": settings.parsing.enrichment_llm,
        "agent_llm": settings.agent.agent_llm,
        "papers_dir": str(get_papers_dir()),
        "temperature": settings.temperature,
        "evidence_k": settings.answer.evidence_k,
        "answer_max_sources": settings.answer.answer_max_sources,
        "multimodal": str(settings.parsing.multimodal),
        "has_openai_key": bool(os.getenv("OPENAI_API_KEY")),
        "has_google_key": bool(os.getenv("GOOGLE_API_KEY")),
        "has_perplexity_key": bool(os.getenv("PERPLEXITY_API_KEY")),
    }
