"""National Rail live departures (Darwin LDBWS via the Rail Data Marketplace, JSON).

Covers every GB train operator (Thameslink, Southern, c2c, Southeastern, GWR, …).
Each user needs a free Rail Data Marketplace consumer key (sent as the x-apikey header).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import aiohttp

from .api import TflAuthError, TflConnectionError, TflError

_LOGGER = logging.getLogger(__name__)

# The product path differs between Rail Data Marketplace subscriptions: try both, remember the one that works.
NR_BASES = (
    "https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS",
    "https://api1.raildata.org.uk/1010-live-departure-board-dep/LDBWS",
)
NR_BOARD_PATH = "/api/20220120/GetDepBoardWithDetails/{crs}"
NR_PREFIX = "NR:"
NR_MODE = "national-rail"
NR_COLOR = "#1E3A8A"
LONDON = ZoneInfo("Europe/London")
TIMEOUT = aiohttp.ClientTimeout(total=20)
STATIONS_FILE = Path(__file__).parent / "data" / "nr_stations.json"
_TAGS = re.compile(r"<[^>]+>")
_SPACES = re.compile(r"\s+")
_TIME = re.compile(r"^\d{1,2}:\d{2}$")

_stations: list[tuple[str, str]] | None = None


def load_stations() -> list[tuple[str, str]]:
    """[(CRS, name)] of every station Darwin knows (blocking: call in the executor once)."""
    global _stations  # noqa: PLW0603
    if _stations is None:
        data = json.loads(STATIONS_FILE.read_text(encoding="utf-8"))
        _stations = [(crs, name) for crs, name in data["stations"]]
    return _stations


def is_nr_stop(stop_id: str) -> bool:
    return str(stop_id).startswith(NR_PREFIX)


def crs_of(stop_id: str) -> str:
    return str(stop_id)[len(NR_PREFIX):].upper()


def nr_stop(crs: str, name: str) -> dict[str, Any]:
    return {
        "id": f"{NR_PREFIX}{crs.upper()}",
        "name": name,
        "letter": "",
        "towards": "",
        "crs": crs.upper(),
        "modes": [NR_MODE],
        "lines": [],
    }


def search_stations(query: str, limit: int = 15) -> list[dict[str, Any]]:
    """Name or CRS code search over the bundled station list (stations must be loaded)."""
    q = " ".join(query.lower().split())
    if len(q) < 3 and not (len(q) == 3 and q.isalpha()):
        return []
    stations = _stations or []
    exact = [s for s in stations if s[0].lower() == q]
    starts = [s for s in stations if s[1].lower().startswith(q) and s not in exact]
    words = [s for s in stations if f" {q}" in f" {s[1].lower()}" and s not in exact and s not in starts]
    contains = [s for s in stations if q in s[1].lower() and s not in exact and s not in starts and s not in words]
    return [nr_stop(crs, name) for crs, name in (exact + starts + words + contains)[:limit]]


def clean_text(text: str | None) -> str:
    return _SPACES.sub(" ", _TAGS.sub(" ", str(text or ""))).replace("&amp;", "&").strip()


def _london_ts(hhmm: str, now: datetime) -> float | None:
    """'10:32' (London time, around now) -> unix time; handles boards that cross midnight."""
    if not _TIME.match(hhmm or ""):
        return None
    hour, minute = (int(x) for x in hhmm.split(":"))
    local_now = now.astimezone(LONDON)
    t = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if t - local_now > timedelta(hours=12):
        t -= timedelta(days=1)
    elif local_now - t > timedelta(hours=12):
        t += timedelta(days=1)
    return t.timestamp()


def _location_names(locations: list[dict[str, Any]] | None) -> str:
    names = []
    for loc in locations or []:
        name = clean_text(loc.get("locationName"))
        if loc.get("via"):
            name += f" {clean_text(loc['via'])}"
        if name:
            names.append(name)
    return " & ".join(names)


def parse_board(board: dict[str, Any], now: datetime) -> dict[str, Any]:
    """GetDepBoardWithDetails JSON -> {'departures': [...], 'messages': [...], 'location': str}."""
    departures: list[dict[str, Any]] = []
    services = (board or {}).get("trainServices") or []
    services += [dict(s, _bus=True) for s in (board or {}).get("busServices") or []]
    for svc in services:
        std = str(svc.get("std") or "")
        etd = str(svc.get("etd") or "")
        scheduled = _london_ts(std, now)
        if scheduled is None:
            continue
        cancelled = bool(svc.get("isCancelled")) or etd.lower() == "cancelled"
        expected = _london_ts(etd, now) if _TIME.match(etd) else scheduled
        if cancelled:
            status = "Cancelled"
        elif etd.lower() == "on time" or etd == std:
            status = "On time"
        elif _TIME.match(etd):
            status = f"Exp {etd}"
        else:
            status = etd or "Delayed"  # 'Delayed' with no estimate
        calling: list[str] = []
        for group in svc.get("subsequentCallingPoints") or []:
            for point in (group or {}).get("callingPoint") or []:
                name = clean_text(point.get("locationName"))
                if name and name not in calling:
                    calling.append(name)
        operator = clean_text(svc.get("operator"))
        departures.append(
            {
                "line": str(svc.get("operatorCode") or "").lower() or "nr",
                "line_name": operator,
                "mode": NR_MODE,
                "destination": _location_names(svc.get("destination")) or "Check front of train",
                "platform": "BUS" if svc.get("_bus") else str(svc.get("platform") or ""),
                "direction": "",
                "expected": int(round(expected or scheduled)),
                "scheduled": std,
                "status": status,
                "cancelled": cancelled,
                "reason": clean_text(svc.get("cancelReason") if cancelled else svc.get("delayReason")),
                "calling_at": calling,
                "minutes": max(0, int(((expected or scheduled) - now.timestamp()) // 60)),
                "color": NR_COLOR,
                "vehicle": str(svc.get("serviceID") or ""),
                "location": "",
                "length": svc.get("length") or 0,
            }
        )
    departures.sort(key=lambda d: (d["expected"], d["destination"]))
    messages = [
        clean_text(m.get("Value") if isinstance(m, dict) else m)
        for m in (board or {}).get("nrccMessages") or []
    ]
    return {
        "departures": departures,
        "messages": [m for m in messages if m],
        "location": clean_text((board or {}).get("locationName")),
    }


class NationalRailApi:
    """Darwin Live Departure Board (Rail Data Marketplace product, JSON)."""

    def __init__(self, session: aiohttp.ClientSession, api_key: str) -> None:
        self._session = session
        self._key = (api_key or "").strip()
        self._base: str | None = None

    async def board(self, crs: str, rows: int = 10) -> dict[str, Any]:
        bases = [self._base] if self._base else list(NR_BASES)
        last: Exception | None = None
        errors: list[Exception] = []
        for base in bases:
            url = f"{base}{NR_BOARD_PATH.format(crs=crs.upper())}"
            try:
                async with self._session.get(
                    url,
                    params={"numRows": rows, "timeWindow": 120},
                    headers={"x-apikey": self._key, "Accept": "application/json"},
                    timeout=TIMEOUT,
                ) as resp:
                    if resp.status in (401, 403):
                        # the key may belong to the other product path: try it before giving up
                        last = TflAuthError("National Rail rejected the key")
                        errors.append(last)
                        continue
                    if resp.status == 404:
                        last = TflConnectionError(f"National Rail product not found at {base}")
                        continue
                    if resp.status == 400:
                        raise TflError(f"National Rail: unknown station code {crs}")
                    if resp.status == 429:
                        raise TflConnectionError("National Rail rate limit reached")
                    if resp.status >= 400:
                        raise TflConnectionError(f"National Rail error {resp.status}")
                    data = await resp.json(content_type=None)
                    self._base = base
                    return data or {}
            except (aiohttp.ClientError, asyncio.TimeoutError) as err:
                last = TflConnectionError(f"Cannot reach National Rail: {err}")
            except ValueError as err:
                raise TflError(f"Invalid response from National Rail: {err}") from err
        if any(isinstance(e, TflAuthError) for e in errors):
            raise TflAuthError("National Rail rejected the key")
        raise last or TflConnectionError("National Rail is not reachable")

    async def validate(self) -> None:
        await self.board("KGX", 1)
