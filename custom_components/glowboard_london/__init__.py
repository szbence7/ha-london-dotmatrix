"""Glowboard London: live TfL arrivals with dot-matrix dashboard cards.

One config entry = one TfL connection (optional app_key). Each stop is a config subentry.
"""

from __future__ import annotations

from homeassistant.const import CONF_API_KEY, Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.typing import ConfigType

from . import websocket
from .api import TflApi
from .const import DOMAIN, SUBENTRY_STOP
from .coordinator import GlowboardConfigEntry, RuntimeData, StatusCache, StopCoordinator
from .frontend import async_setup_frontend

PLATFORMS: list[Platform] = [Platform.SENSOR]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Serve the cards and register the websocket commands used by the card editors."""
    await async_setup_frontend(hass)
    websocket.async_register(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: GlowboardConfigEntry) -> bool:
    """Set up the API connection and one coordinator per stop."""
    api = TflApi(async_get_clientsession(hass), entry.data.get(CONF_API_KEY))
    runtime = RuntimeData(api=api, status=StatusCache(api))

    for subentry in entry.subentries.values():
        if subentry.subentry_type != SUBENTRY_STOP:
            continue
        coordinator = StopCoordinator(hass, entry, subentry, api, runtime.status)
        await coordinator.async_config_entry_first_refresh()
        runtime.coordinators[subentry.subentry_id] = coordinator

    entry.runtime_data = runtime
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    # options changed, stop added or removed -> reload
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: GlowboardConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: GlowboardConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
