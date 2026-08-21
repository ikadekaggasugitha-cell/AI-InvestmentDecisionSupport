"""
Reports router — Phase 13 (Laporan).

On-demand PDF reports generated from live data. `list` advertises the catalogue,
`generate` reports metadata (size) after rendering, and `download` streams the
PDF as an attachment. All routes are protected at registration in api/main.py.
"""

from datetime import datetime, timezone

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from api.core.auth import CurrentUser
from api.models.reports import (
    ReportGenerateResponse,
    ReportListResponse,
    ReportType,
)
from api.services.report_service import generate_pdf, list_reports

router = APIRouter(prefix="/v1/reports", tags=["reports"])


@router.get("", response_model=ReportListResponse, summary="List generatable reports")
async def reports_list_endpoint(_user: CurrentUser) -> ReportListResponse:
    """Catalogue of on-demand PDF reports with bilingual labels."""
    return list_reports()


@router.post(
    "/{report_type}/generate",
    response_model=ReportGenerateResponse,
    summary="Generate a report and return its metadata",
)
async def reports_generate_endpoint(
    _user: CurrentUser, report_type: ReportType,
) -> ReportGenerateResponse:
    """Render the PDF now (from live data) and report its size; fetch via /download."""
    pdf = await generate_pdf(report_type)
    return ReportGenerateResponse(
        type=report_type,
        status="ready",
        sizeKb=round(len(pdf) / 1024, 1),
        generatedAt=datetime.now(timezone.utc).isoformat(),
    )


@router.get("/{report_type}/download", summary="Download a report as PDF")
async def reports_download_endpoint(
    _user: CurrentUser, report_type: ReportType,
) -> StreamingResponse:
    """Stream a freshly-rendered PDF as a file attachment."""
    pdf = await generate_pdf(report_type)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"aidss-{report_type.value}-{stamp}.pdf"
    return StreamingResponse(
        iter([pdf]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
