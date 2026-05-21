"""Analysis API routes — evidence matrix build/read/status."""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.analysis_service import get_analysis_service
from ..services.contradiction_service import get_contradiction_service
from ..services.difference_service import get_difference_service
from ..services.gap_service import get_gap_service
from ..services.paper_manifest_service import get_manifest_service
from ..services.similarity_service import get_similarity_service

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


class SimilarityRequest(BaseModel):
    file_location: str
    limit: int = 10
    include_indexed_only: bool = True


class DifferenceRequest(BaseModel):
    file_locations: list[str]
    include_indexed_only: bool = True


class GapRequest(BaseModel):
    file_locations: list[str] | None = None
    include_indexed_only: bool = True
    scope: Literal["selection", "corpus"] | None = None


class ContradictionRequest(BaseModel):
    file_locations: list[str] | None = None
    scope: Literal["selection", "corpus"] | None = None
    include_indexed_only: bool = False
    limit: int = 20


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


@router.post("/similarity")
async def find_similar_papers(request: SimilarityRequest):
    """Return deterministic paper similarity over manifest/Matrix metadata."""
    service = get_similarity_service()
    try:
        return await service.find_similar(
            file_location=request.file_location,
            limit=request.limit,
            include_indexed_only=request.include_indexed_only,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Source paper not found") from exc


@router.post("/difference")
async def compare_paper_differences(request: DifferenceRequest):
    """Return deterministic structured differences for selected papers."""
    service = get_difference_service()
    try:
        return await service.compare_papers(
            file_locations=request.file_locations,
            include_indexed_only=request.include_indexed_only,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Selected paper not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/gaps")
async def find_matrix_gaps(request: GapRequest):
    """Return deterministic Matrix coverage gaps for selected papers or corpus."""
    service = get_gap_service()
    try:
        return await service.find_gaps(
            file_locations=request.file_locations,
            include_indexed_only=request.include_indexed_only,
            scope=request.scope,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Selected paper not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/contradictions")
async def find_candidate_contradictions(request: ContradictionRequest):
    """Return deterministic Matrix-only candidate tensions between papers."""
    service = get_contradiction_service()
    try:
        return await service.find_contradictions(
            file_locations=request.file_locations,
            scope=request.scope,
            include_indexed_only=request.include_indexed_only,
            limit=request.limit,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Selected paper not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
