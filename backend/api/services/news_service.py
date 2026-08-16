"""
IDX disclosure feed.

Replaces a browser-side fetch that went through the public CORS proxy
allorigins.win — which now answers with a GitHub Pages 404, so `res.ok` was
false on every call and the hook quietly rendered an empty list. Nobody saw an
error; the news panel simply looked like a slow day, indefinitely.

Fetching server-side also removes the CORS problem that motivated the proxy in
the first place, and keeps a third party that can rewrite responses out of the
path of anything shown in a financial tool.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from api.core.config import get_settings
from api.core.redis_client import redis_get_json, redis_set_json
from api.models.news import NewsItem, NewsResponse

logger = logging.getLogger(__name__)

_ANNOUNCEMENT_URL = "https://www.idx.co.id/primary/ListedCompany/GetAnnouncement"
_ORIGIN = "https://www.idx.co.id/"
_CACHE_KEY = "news:idx:disclosures"

# Disclosures are filed through the day but individual items never change once
# published, so a 15-minute cache costs nothing in freshness.
NEWS_TTL = 900


def _detail_url(item: dict[str, Any]) -> str:
    attachments = item.get("attachments") or []
    if attachments and isinstance(attachments, list):
        path = (attachments[0] or {}).get("FullSavePath") or ""
        if path:
            return path if path.startswith("http") else f"https://www.idx.co.id{path}"
    return "https://www.idx.co.id/id/perusahaan-tercatat/keterbukaan-informasi/"


def _parse_announcement(raw: dict[str, Any]) -> NewsItem | None:
    """
    Map one announcement record. Returns None when the payload lacks the fields
    that make an item meaningful — an untitled, undated disclosure is noise.
    """
    item = raw.get("pengumuman") or raw
    title = (item.get("JudulPengumuman") or "").strip()
    published = item.get("TglPengumuman") or ""
    if not title or not published:
        return None

    return NewsItem(
        id=str(item.get("Id") or item.get("NoPengumuman") or title[:64]),
        title=title,
        category=(item.get("JenisPengumuman") or "").strip(),
        symbol=(item.get("Kode_Emiten") or "").strip().upper()[:12],
        publishedAt=str(published),
        url=_detail_url(raw),
        source="IDX",
    )


async def _fetch_announcements(limit: int, days_back: int) -> list[dict[str, Any]]:
    import asyncio

    settings = get_settings()  # noqa: F841 — reserved for future vendor switching

    try:
        from curl_cffi import requests as curl_requests
    except ImportError:
        logger.error("news: curl_cffi missing; IDX rejects plain HTTP clients")
        return []

    today = datetime.now(timezone.utc).date()
    params = {
        "indexFrom": 0,
        "pageSize": limit,
        "dateFrom": (today - timedelta(days=days_back)).strftime("%Y%m%d"),
        "dateTo": today.strftime("%Y%m%d"),
        "lang": "id",
        "keyword": "",
    }

    def _do() -> Any:
        session = curl_requests.Session(impersonate="chrome", timeout=25)
        session.headers.update({"Referer": _ORIGIN, "Accept": "application/json"})
        try:
            return session.get(_ANNOUNCEMENT_URL, params=params)
        finally:
            session.close()

    try:
        resp = await asyncio.to_thread(_do)
    except Exception as exc:  # noqa: BLE001 — a news outage must not break the page
        logger.warning("news: IDX request failed — %s", exc)
        return []

    if resp.status_code != 200 or "json" not in resp.headers.get("content-type", ""):
        logger.warning("news: IDX returned HTTP %d", resp.status_code)
        return []

    return (resp.json() or {}).get("Replies") or []


async def get_news(limit: int = 20, days_back: int = 7) -> NewsResponse:
    """
    Recent IDX disclosures, newest first.

    Reports `source="unavailable"` rather than an empty success when the feed
    cannot be reached, so the UI can distinguish "no filings" from "we could
    not ask" — the exact distinction the dead proxy erased.
    """
    cached = await redis_get_json(_CACHE_KEY)
    if cached:
        try:
            return NewsResponse(**cached)
        except Exception:  # noqa: BLE001 — stale shape, refetch
            logger.debug("news: discarding unreadable cache entry")

    raw_items = await _fetch_announcements(limit=limit, days_back=days_back)
    now = datetime.now(timezone.utc).isoformat()

    if not raw_items:
        return NewsResponse(items=[], fetchedAt=now, source="unavailable")

    items = [i for i in (_parse_announcement(r) for r in raw_items) if i]
    items.sort(key=lambda i: i.publishedAt, reverse=True)

    response = NewsResponse(items=items[:limit], fetchedAt=now, source="idx")
    await redis_set_json(_CACHE_KEY, response.model_dump(), ttl=NEWS_TTL)
    logger.info("news: %d disclosures from IDX", len(response.items))
    return response
