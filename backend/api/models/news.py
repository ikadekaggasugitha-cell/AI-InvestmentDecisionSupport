"""
News / disclosure models — IDX keterbukaan informasi.

The source is IDX's own announcement feed rather than a news aggregator. That
narrowing is deliberate: disclosures are primary documents filed by the issuer
and timestamped by the exchange, so every item is attributable to a named
emiten and a filing date. General financial news is neither — and the previous
implementation fetched it through an anonymous CORS proxy that has since gone
dead, returning nothing, silently, for however long.
"""

from pydantic import BaseModel


class NewsItem(BaseModel):
    """One IDX disclosure."""

    id: str
    title: str
    # Announcement category as IDX files it, e.g. "Laporan Keuangan".
    category: str = ""
    # Issuer code, when the filing names one. Blank for exchange-wide notices.
    symbol: str = ""
    publishedAt: str          # ISO timestamp
    url: str = ""
    source: str = "IDX"


class NewsResponse(BaseModel):
    """Envelope returned by GET /v1/news"""

    items: list[NewsItem] = []
    fetchedAt: str            # ISO timestamp
    # "idx" when live from the exchange, "unavailable" when the feed could not
    # be reached. Never a silent empty list dressed up as "no news today".
    source: str = "idx"
