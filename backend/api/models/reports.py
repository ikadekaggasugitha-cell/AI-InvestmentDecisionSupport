"""
Report API models — Phase 13 (Laporan).

Reports are generated on demand as PDFs from live portfolio / risk / signal data.
There is no stored-file concept: every type is always "ready" to generate, so the
list endpoint advertises what can be produced and the download endpoint streams a
freshly-rendered PDF.
"""

from enum import Enum

from pydantic import BaseModel


class ReportType(str, Enum):
    performance = "performance"
    quarterly = "quarterly"
    risk = "risk"
    tax_loss = "tax_loss"
    signal_audit = "signal_audit"


class ReportMeta(BaseModel):
    """One generatable report, with bilingual labels for the UI."""
    type: ReportType
    titleId: str
    titleEn: str
    descId: str
    descEn: str
    labelId: str          # short category chip, e.g. "Kinerja"
    labelEn: str
    status: str = "ready"  # always on-demand generatable


class ReportListResponse(BaseModel):
    reports: list[ReportMeta] = []


class ReportGenerateResponse(BaseModel):
    """Returned after a generate call — the PDF itself is fetched via /download."""
    type: ReportType
    status: str = "ready"
    sizeKb: float = 0.0
    generatedAt: str = ""
