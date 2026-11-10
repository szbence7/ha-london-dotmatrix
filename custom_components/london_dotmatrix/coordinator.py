"""Data update coordinators: one per stop (config subentry) + a shared line status cache."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigSubentry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import TflApi, TflAuthError, TflError
from .const import (
    CONF_LINES,
    CONF_MAX_DEPARTURES,
    CONF_SCAN_INTERVAL,
    CONF_STOP_ID,
    CONF_STOP_NAME,
    DEFAULT_MAX_DEPARTURES,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    STATUS_TTL,
)
from .national_rail import NationalRailApi, crs_of, is_nr_stop, parse_board
from .parser import parse_arrivals

_LOGGER = logging.getLogger(__name__)


@dataclass
class StatusCache:
    """Line status shared by every stop, refreshed at most every STATUS_TTL seconds per line."""

    api: TflApi
    data: dict[str, dict[str, Any]] = field(default_factory=dict)
    fetched: dict[str, float] = field(default_factory=dict)

    async def get(self, line_ids: list[str]) -> dict[str, dict[str, Any]]:
        now = time.monotonic()
        stale = [line for line in line_ids if now - self.fetched.get(line, -1e9) > STATUS_TTL]
        if stale:
            try:
                self.data.update(await self.api.line_status(stale))
                for line in stale:
                    self.fetched[line] = now
            except TflAuthError:
                raise
            except TflError as err:  # disruptions are a nice-to-have: never fail the board for them
                _LOGGER.debug("Line status update failed: %s", err)
        return {line: self.data[line] for line in line_ids if line in self.data}


@dataclass
class RuntimeData:
    """Shared API client + one coordinator per stop subentry."""

    api: TflApi
    status: StatusCache
    nr: NationalRailApi | None = None
    coordinators: dict[str, "StopCoordinator"] = field(default_factory=dict)


type DotmatrixConfigEntry = ConfigEntry[RuntimeData]


class StopCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Polls live arrivals for a single stop point."""

    config_entry: DotmatrixConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        entry: DotmatrixConfigEntry,
        subentry: ConfigSubentry,
        api: TflApi,
        status: StatusCache,
        nr: NationalRailApi | None = None,
    ) -> None:
        interval = entry.options.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
        super().__init__(
            hass,
            _LOGGER,
            config_entry=entry,
            name=f"{DOMAIN}_{subentry.data[CONF_STOP_ID]}",
            update_interval=timedelta(seconds=interval),
        )
        self.api = api
        self.status = status
        self.nr = nr
        self.subentry = subentry
        self.stop_id: str = subentry.data[CONF_STOP_ID]
        self.stop_name: str = subentry.data.get(CONF_STOP_NAME) or self.stop_id

    async def _async_update_data(self) -> dict[str, Any]:
        if is_nr_stop(self.stop_id):
            return await self._national_rail()
        try:
            raw = await self.api.arrivals(self.stop_id)
            departures = parse_arrivals(raw, time.time())
            line_ids = list(
                dict.fromkeys(
                    [line["id"] for line in self.subentry.data.get(CONF_LINES) or [] if line.get("mode") != "bus"]
                    + [d["line"] for d in departures if d["mode"] != "bus"]
                )
            )
            # bus routes: only the ones running right now, there can be dozens at a stop
            line_ids += list(dict.fromkeys(d["line"] for d in departures if d["mode"] == "bus"))
            status = await self.status.get(line_ids)
        except TflAuthError as err:
            raise ConfigEntryAuthFailed("TfL app_key rejected") from err
        except TflError as err:
            raise UpdateFailed(f"Error fetching arrivals: {err}") from err
        return {"departures": departures, "status": status}

    async def _national_rail(self) -> dict[str, Any]:
        """National Rail station: Darwin departure board (needs the Rail Data Marketplace key)."""
        if self.nr is None:
            raise UpdateFailed("Add your National Rail (Rail Data Marketplace) key: integration ⋮ → Reconfigure")
        limit = self.config_entry.options.get(CONF_MAX_DEPARTURES, DEFAULT_MAX_DEPARTURES)
        try:
            board = await self.nr.board(crs_of(self.stop_id), min(max(limit, 5), 25))
        except TflAuthError as err:
            raise ConfigEntryAuthFailed("National Rail key rejected") from err
        except TflError as err:
            raise UpdateFailed(f"Error fetching National Rail departures: {err}") from err
        parsed = parse_board(board, datetime.now(timezone.utc))
        return {"departures": parsed["departures"], "status": {}, "messages": parsed["messages"]}
