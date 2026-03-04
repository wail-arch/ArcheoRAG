"""Settings API routes — view and update configuration."""

from __future__ import annotations

import os
import pathlib
import re
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from ..services.config import get_current_config, save_settings_overrides
from ..services.qa_service import get_qa_service

_ENV_FILE = pathlib.Path(__file__).resolve().parent.parent.parent / ".env"


def _persist_keys_to_env(keys: dict[str, str]) -> None:
    """Write/update API keys in the .env file so they survive restarts."""
    # Read existing content or start fresh
    content = _ENV_FILE.read_text(encoding="utf-8") if _ENV_FILE.exists() else ""
    for key, value in keys.items():
        pattern = rf"^{re.escape(key)}=.*$"
        replacement = f"{key}={value}"
        if re.search(pattern, content, flags=re.MULTILINE):
            content = re.sub(pattern, replacement, content, flags=re.MULTILINE)
        else:
            content = content.rstrip("\n") + f"\n{replacement}\n"
    _ENV_FILE.write_text(content, encoding="utf-8")

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    """Updatable settings fields."""

    llm: str | None = None
    summary_llm: str | None = None
    embedding: str | None = None
    enrichment_llm: str | None = None
    agent_llm: str | None = None
    temperature: float | None = None
    evidence_k: int | None = None
    answer_max_sources: int | None = None

    # API keys — set as env vars
    openai_api_key: str | None = None
    google_api_key: str | None = None
    perplexity_api_key: str | None = None


@router.get("")
async def get_settings() -> dict[str, Any]:
    """Get current configuration (API keys are masked)."""
    return get_current_config()


@router.put("")
async def update_settings(update: SettingsUpdate) -> dict[str, Any]:
    """Update settings. Model changes are persisted to settings.json.

    API key changes are set as environment variables for the current session.
    """
    # Build overrides dict from non-None fields (excluding API keys)
    overrides: dict[str, Any] = {}
    for field_name in ("llm", "summary_llm", "embedding", "enrichment_llm",
                       "agent_llm", "temperature", "evidence_k", "answer_max_sources"):
        value = getattr(update, field_name)
        if value is not None:
            overrides[field_name] = value

    # Save model overrides
    if overrides:
        save_settings_overrides(overrides)

    # Update API keys — in env AND persist to .env file
    key_map = {
        "OPENAI_API_KEY": update.openai_api_key,
        "GOOGLE_API_KEY": update.google_api_key,
        "PERPLEXITY_API_KEY": update.perplexity_api_key,
    }
    new_keys = {k: v for k, v in key_map.items() if v}
    if new_keys:
        for k, v in new_keys.items():
            os.environ[k] = v
        _persist_keys_to_env(new_keys)

    # Reload settings in the QA service
    service = get_qa_service()
    service.reload_settings()

    return get_current_config()
