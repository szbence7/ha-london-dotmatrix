"""Minimal async client for the TfL Unified API."""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any
from urllib.parse import quote

import aiohttp

from .const import API_BASE, TFL_MODES
from .parser import collect_stops, parse_line_status, sort_stops

_LOGGER = logging.getLogger(__name__)
TIMEOUT = aiohttp.ClientTimeout(total=20)
SEARCH_CACHE_SECONDS = 300
MAX_DETAIL_IDS = 20


class TflError(Exception):
    """Generic TfL API error."""


class TflConnectionError(TflError):
    """Network problem, rate limit or 5xx."""


class TflAuthError(TflError):
    """The app_key was rejected."""


class TflApi:
    """TfL Unified API. The app_key is optional but raises the rate limit a lot."""

    def __init__(self, session: aiohttp.ClientSession, api_key: str | None = None) -> None:
        self._session = session
        self._api_key = (api_key or "").strip()
        self._search_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    @property
    def has_key(self) -> bool:
        return bool(self._api_key)

    async def _get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        query = dict(params or {})
        if self._api_key:
            query["app_key"] = self._api_key
        try:
            async with self._session.get(f"{API_BASE}{path}", params=query, timeout=TIMEOUT) as resp:
                if resp.status in (401, 403):
                    raise TflAuthError("TfL rejected the app_key")
                if resp.status == 429:
                    body = await resp.text()
                    if "app_key" in body.lower() or "subscription key" in body.lower():
                        raise TflAuthError("TfL rejected the app_key")
                    raise TflConnectionError("TfL rate limit reached (add a free app_key to raise it)")
                if resp.status == 404:
                    return None
                if resp.status >= 400:
                    raise TflConnectionError(f"TfL API error {resp.status}")
                return await resp.json(content_type=None)
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            raise TflConnectionError(f"Cannot reach TfL: {err}") from err
        except ValueError as err:
            raise TflError(f"Invalid response from TfL: {err}") from err

    async def validate(self) -> None:
        """Cheap request that fails with TflAuthError on a bad key."""
        await self._get("/Line/victoria/Status")

    async def search_stops(self, query: str) -> list[dict[str, Any]]:
        """Free text search over every TfL mode; hubs expand into their stations and bus stops."""
        query = " ".join(query.split())
        cache_key = query.lower()
        cached = self._search_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < SEARCH_CACHE_SECONDS:
            return [dict(s) for s in cached[1]]

        result = await self._get(
            f"/StopPoint/Search/{quote(query, safe='')}",
            {"modes": ",".join(TFL_MODES), "maxResults": MAX_DETAIL_IDS},
        )
        matches = (result or {}).get("matches") or []
        ids = list(dict.fromkeys(str(m["id"]) for m in matches if m.get("id")))[:MAX_DETAIL_IDS]
        towards = {str(m["id"]): str(m.get("towards") or "") for m in matches if m.get("id")}
        if not ids:
            return []
        details = await self._get(f"/StopPoint/{','.join(quote(i, safe='') for i in ids)}")
        if isinstance(details, dict):
            details = [details]
        stops = sort_stops(collect_stops(details or [], towards), query)
        self._search_cache[cache_key] = (time.monotonic(), stops)
        if len(self._search_cache) > 100:
            oldest = min(self._search_cache, key=lambda k: self._search_cache[k][0])
            self._search_cache.pop(oldest, None)
        return [dict(s) for s in stops]

    async def stop_details(self, stop_id: str) -> dict[str, Any] | None:
        """Details of one stop point (normalised), or None if unknown."""
        details = await self._get(f"/StopPoint/{quote(stop_id, safe='')}")
        if isinstance(details, list):
            details = details[0] if details else None
        if not details:
            return None
        for stop in collect_stops([details]):
            if stop["id"] == stop_id:
                return stop
        return None

    async def arrivals(self, stop_id: str) -> list[dict[str, Any]]:
        return await self._get(f"/StopPoint/{quote(stop_id, safe='')}/Arrivals") or []

    async def line_status(self, line_ids: list[str]) -> dict[str, dict[str, Any]]:
        if not line_ids:
            return {}
        out: dict[str, dict[str, Any]] = {}
        # keep URLs short: busy bus stops can have 20+ routes
        for i in range(0, len(line_ids), 20):
            chunk = ",".join(quote(line, safe="") for line in line_ids[i : i + 20])
            out.update(parse_line_status(await self._get(f"/Line/{chunk}/Status") or []))
        return out
