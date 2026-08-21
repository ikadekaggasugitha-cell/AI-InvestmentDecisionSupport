"""
Report Service — Phase 13 (Laporan)

Renders on-demand PDF reports from LIVE data (portfolio optimiser, risk engine,
AI signals). No stored files: each call pulls current data and builds the PDF in
memory with reportlab (pure-python, no system deps). Every generator degrades to
a clearly-labelled "data unavailable" note rather than failing the download, so a
missing DB/model never turns into an HTTP 500 on a report the user requested.
"""

from __future__ import annotations

import io
import logging
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

from api.models.reports import ReportListResponse, ReportMeta, ReportType

logger = logging.getLogger(__name__)

# ── Report catalogue (bilingual labels for the UI) ────────────────────────────

_DEFS: dict[ReportType, dict[str, str]] = {
    ReportType.performance: {
        "titleId": "Laporan Kinerja Portofolio", "titleEn": "Portfolio Performance Report",
        "descId": "Alokasi optimal, bobot, dan ekspektasi imbal hasil per posisi.",
        "descEn": "Optimal allocation, weights, and expected return per position.",
        "labelId": "Kinerja", "labelEn": "Performance",
    },
    ReportType.quarterly: {
        "titleId": "Tinjauan Investasi Kuartalan", "titleEn": "Quarterly Investment Review",
        "descId": "Ringkasan alokasi, metrik portofolio, dan proyeksi.",
        "descEn": "Allocation summary, portfolio metrics, and outlook.",
        "labelId": "Kuartalan", "labelEn": "Quarterly",
    },
    ReportType.risk: {
        "titleId": "Laporan Penilaian Risiko", "titleEn": "Risk Assessment Report",
        "descId": "VaR/CVaR, volatilitas, beta, dan hasil stress test.",
        "descEn": "VaR/CVaR, volatility, beta, and stress-test results.",
        "labelId": "Risiko", "labelEn": "Risk",
    },
    ReportType.tax_loss: {
        "titleId": "Peluang Tax-Loss Harvesting", "titleEn": "Tax-Loss Harvesting Opportunities",
        "descId": "Posisi dengan ekspektasi imbal hasil negatif — kandidat efisiensi pajak.",
        "descEn": "Positions with negative expected return — tax-efficiency candidates.",
        "labelId": "Pajak", "labelEn": "Tax",
    },
    ReportType.signal_audit: {
        "titleId": "Audit Kinerja Sinyal AI", "titleEn": "AI Signal Performance Audit",
        "descId": "Probabilitas naik, tier, dan skor model per saham.",
        "descEn": "Upside probability, tier, and model score per stock.",
        "labelId": "Audit AI", "labelEn": "AI Audit",
    },
}


def list_reports() -> ReportListResponse:
    return ReportListResponse(reports=[
        ReportMeta(type=t, status="ready", **d) for t, d in _DEFS.items()
    ])


# ── PDF building blocks ───────────────────────────────────────────────────────

def _table(headers: list[str], rows: list[list[str]]) -> Table:
    data = [headers] + (rows or [["—"] * len(headers)])
    t = Table(data, repeatRows=1, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f1f5f9")]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    return t


def _num(v, suffix: str = "", dp: int = 2) -> str:
    try:
        return f"{float(v):,.{dp}f}{suffix}"
    except (TypeError, ValueError):
        return "—"


async def _performance_story(styles, title_key: str):
    from api.services.portfolio_service import get_portfolio_optimisation

    story = []
    try:
        r = await get_portfolio_optimisation(uid="default")
        m = r.metrics
        story.append(Paragraph(
            f"Expected return {_num(m.expectedReturn, '%')} · Volatility "
            f"{_num(m.expectedVolatility, '%')} · Sharpe {_num(m.sharpeRatio)} · "
            f"Diversification {_num(m.diversificationRatio)} · source: {r.source}",
            styles["Normal"],
        ))
        story.append(Spacer(1, 6))
        rows = [
            [w.symbol, w.name[:26], _num(w.weightPct, "%", 1),
             _num(w.expectedReturn, "%", 1), _num(w.currentValue, "", 0), str(w.lots)]
            for w in r.weights
        ]
        story.append(_table(
            ["Symbol", "Name", "Weight", "E[R]", "Value (IDR)", "Lots"], rows))
    except Exception as exc:  # noqa: BLE001
        logger.warning("report_service: performance data unavailable — %s", exc)
        story.append(Paragraph("Portfolio data unavailable at generation time.", styles["Italic"]))
    return story


async def _risk_story(styles):
    from api.services.risk_service import get_risk_metrics

    story = []
    try:
        r = await get_risk_metrics(portfolio_id="default")
        k = r.risk
        story.append(_table(
            ["Metric", "Value"],
            [
                ["VaR 95%", _num(k.var95, "", 0)],
                ["CVaR 95%", _num(k.cvar95, "", 0)],
                ["Volatility", _num(k.volatility, "%")],
                ["Max Drawdown", _num(k.maxDrawdown, "%")],
                ["Beta", _num(k.beta)],
                ["Sharpe", _num(k.sharpe)],
                ["Sortino", _num(k.sortino)],
                ["Alpha", _num(k.alpha, "%")],
            ],
        ))
        story.append(Spacer(1, 8))
        story.append(Paragraph("Stress tests", styles["Heading3"]))
        story.append(_table(
            ["Scenario", "Impact %", "Probability %"],
            [[s.scenarioEn, _num(s.impact), _num(s.probability)] for s in r.stressTests],
        ))
        story.append(Spacer(1, 8))
        story.append(Paragraph("Sector exposure", styles["Heading3"]))
        story.append(_table(
            ["Sector", "Weight %", "Benchmark %", "Over/Under"],
            [[s.sectorEn, _num(s.weight), _num(s.benchmark), _num(s.overUnder)]
             for s in r.sectorExposure],
        ))
    except Exception as exc:  # noqa: BLE001
        logger.warning("report_service: risk data unavailable — %s", exc)
        story.append(Paragraph("Risk data unavailable at generation time.", styles["Italic"]))
    return story


async def _tax_loss_story(styles):
    from api.services.portfolio_service import get_portfolio_optimisation

    story = []
    try:
        r = await get_portfolio_optimisation(uid="default")
        losers = [w for w in r.weights if w.expectedReturn < 0]
        story.append(Paragraph(
            f"{len(losers)} position(s) with a negative expected return — candidates for "
            "tax-loss harvesting. Descriptive analysis only, not tax advice.",
            styles["Normal"],
        ))
        story.append(Spacer(1, 6))
        story.append(_table(
            ["Symbol", "Name", "Weight %", "E[R] %", "Value (IDR)"],
            [[w.symbol, w.name[:26], _num(w.weightPct, "", 1), _num(w.expectedReturn, "", 1),
              _num(w.currentValue, "", 0)] for w in losers],
        ))
    except Exception as exc:  # noqa: BLE001
        logger.warning("report_service: tax-loss data unavailable — %s", exc)
        story.append(Paragraph("Portfolio data unavailable at generation time.", styles["Italic"]))
    return story


async def _signal_audit_story(styles):
    from api.services.signal_service import get_signals

    story = []
    try:
        r = await get_signals()
        rows = [
            [s.symbol, str(s.uprob), getattr(s, "probabilityTier", "") or "",
             _num(s.upside, "%", 1), _num(getattr(s, "modelScore", 0), "", 1),
             _num(s.targetPrice, "", 0)]
            for s in r.signals
        ]
        story.append(Paragraph(f"source: {getattr(r, 'source', 'live')}", styles["Normal"]))
        story.append(Spacer(1, 6))
        story.append(_table(
            ["Symbol", "Uprob", "Tier", "Upside", "Model", "Target"], rows))
    except Exception as exc:  # noqa: BLE001
        logger.warning("report_service: signals unavailable — %s", exc)
        story.append(Paragraph("Signal data unavailable at generation time.", styles["Italic"]))
    return story


async def generate_pdf(report_type: ReportType) -> bytes:
    """Render one report to PDF bytes from current live data."""
    styles = getSampleStyleSheet()
    d = _DEFS[report_type]
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    story = [
        Paragraph(d["titleEn"], styles["Title"]),
        Paragraph(f"{d['titleId']} · generated {now}", styles["Normal"]),
        Paragraph("AIDSS — AI Decision Support System. Descriptive analysis, not investment advice.",
                  styles["Italic"]),
        Spacer(1, 10),
    ]

    if report_type in (ReportType.performance, ReportType.quarterly):
        story += await _performance_story(styles, report_type.value)
    elif report_type == ReportType.risk:
        story += await _risk_story(styles)
    elif report_type == ReportType.tax_loss:
        story += await _tax_loss_story(styles)
    elif report_type == ReportType.signal_audit:
        story += await _signal_audit_story(styles)

    buf = io.BytesIO()
    SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
        title=d["titleEn"], author="AIDSS",
    ).build(story)
    return buf.getvalue()
