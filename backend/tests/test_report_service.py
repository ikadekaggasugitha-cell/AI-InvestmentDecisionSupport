"""
Report generation tests.

Each report type must render a non-empty, valid PDF from whatever data is
available (mock in the test env), and must degrade rather than raise when a data
source is missing — a download the user asked for should never 500.
"""

import pytest

from api.models.reports import ReportType
from api.services.report_service import generate_pdf, list_reports


def test_list_reports_covers_every_type():
    types = {r.type for r in list_reports().reports}
    assert types == set(ReportType)
    for r in list_reports().reports:
        assert r.titleId and r.titleEn and r.labelId  # bilingual labels present


@pytest.mark.parametrize("rtype", list(ReportType))
async def test_generate_pdf_is_valid(rtype):
    pdf = await generate_pdf(rtype)
    assert isinstance(pdf, bytes)
    assert pdf.startswith(b"%PDF-")   # valid PDF magic
    assert len(pdf) > 800             # not an empty shell
