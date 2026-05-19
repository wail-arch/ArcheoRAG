"""Analysis API routes — evidence matrix build/read/status."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.analysis_service import get_analysis_service
from ..services.paper_manifest_service import get_manifest_service

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


class MatrixBuildRequest(BaseModel):
    force: bool = False
    mode: Literal["standard", "cheap"] = "standard"
    file_locations: list[str] | None = None


class MatrixResetRequest(BaseModel):
    clear_overrides: bool = True


class MatrixRowCurationRequest(BaseModel):
    curated_fields: dict[str, list[dict[str, Any]]] | None = None
    clear_curated_fields: list[str] | None = None
    notes: str | None = None
    row_verified: bool | None = None
    verified_fields: list[str] | None = None


class MatrixVerifyRequest(BaseModel):
    verified: bool = True
    field: str | None = None


@router.get("/matrix/status")
async def get_matrix_status():
    """Get evidence matrix availability and freshness."""
    service = get_analysis_service()
    return await service.get_status()


@router.get("/matrix")
async def get_matrix():
    """Return the persisted evidence matrix."""
    service = get_analysis_service()
    return await service.get_matrix()


@router.post("/matrix/build")
async def build_matrix(request: MatrixBuildRequest | None = None):
    """Build or refresh the evidence matrix."""
    service = get_analysis_service()
    try:
        if request is None:
            return await service.build_matrix(force=False)
        return await service.build_matrix(
            force=request.force,
            mode=request.mode,
            file_locations=request.file_locations,
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/matrix/reset")
async def reset_matrix(request: MatrixResetRequest | None = None):
    """Clear persisted matrix rows and researcher curation overrides."""
    service = get_analysis_service()
    return await service.reset_matrix(
        clear_overrides=True if request is None else request.clear_overrides
    )


@router.patch("/matrix/rows/{file_location}")
async def update_matrix_row(file_location: str, request: MatrixRowCurationRequest):
    """Apply researcher curation to one evidence matrix row."""
    service = get_analysis_service()
    try:
        return await service.update_row_curation(
            file_location,
            request.model_dump(exclude_unset=True),
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Matrix row not found") from exc


@router.post("/matrix/rows/{file_location}/verify")
async def verify_matrix_row(file_location: str, request: MatrixVerifyRequest):
    """Mark one row or one field as verified/unverified."""
    service = get_analysis_service()
    try:
        return await service.verify_row(
            file_location=file_location,
            verified=request.verified,
            field=request.field,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Matrix row not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/manifest")
async def get_paper_manifest():
    """Return the lightweight paper manifest, rebuilding it if stale."""
    service = get_manifest_service()
    return await service.get_manifest()


@router.post("/manifest/build")
async def build_paper_manifest():
    """Rebuild the lightweight paper manifest from index and matrix metadata."""
    service = get_manifest_service()
    return await service.build_manifest()
