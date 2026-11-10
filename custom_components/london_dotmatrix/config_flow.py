"""Config flow.

Setup:   optional app_key -> add stops now (search, tick several) or later in the card editor
Later:   "Add stop" (subentry flow): search -> pick a stop
Options: update interval, departures kept
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    ConfigSubentryData,
    ConfigSubentryFlow,
    OptionsFlow,
    SubentryFlowResult,
)
from homeassistant.const import CONF_API_KEY
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .api import TflApi, TflAuthError, TflConnectionError, TflError
from .national_rail import NationalRailApi, load_stations, search_stations
from .parser import sort_stops
from .const import (
    API_KEY_URL,
    CONF_NR_KEY,
    CONF_LETTER,
    CONF_LINES,
    CONF_MAX_DEPARTURES,
    CONF_MODES,
    CONF_QUERY,
    CONF_SCAN_INTERVAL,
    CONF_STOP_ID,
    CONF_STOP_NAME,
    CONF_STOPS,
    CONF_TOWARDS,
    DEFAULT_MAX_DEPARTURES,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    MAX_SCAN_INTERVAL,
    MIN_SCAN_INTERVAL,
    MODE_ICONS,
    NR_KEY_URL,
    SUBENTRY_STOP,
)

MAX_RESULTS = 40
PLACEHOLDERS = {"url": API_KEY_URL, "nr_url": NR_KEY_URL}
ENTRY_TITLE = "TfL live arrivals"


def lines_text(stop: dict[str, Any], limit: int = 8) -> str:
    lines = stop.get("lines") or []
    names = [line["name"] for line in lines[:limit]]
    return ", ".join(names) + (" …" if len(lines) > limit else "")


def stop_title(stop: dict[str, Any]) -> str:
    """'Oxford Circus' / 'Oxford Circus Station (Stop RC)' / 'London Bridge (National Rail)'."""
    title = stop["name"]
    if "national-rail" in (stop.get("modes") or []):
        return f"{title} (National Rail)"
    if stop.get("letter"):
        title += f" (Stop {stop['letter']})"
    return title


def stop_label(stop: dict[str, Any]) -> str:
    """Search result line: icons, name, stop letter, direction, lines."""
    icons = "".join(MODE_ICONS.get(m, "") for m in stop.get("modes") or [])
    label = f"{icons} {stop_title(stop)}"
    if stop.get("towards") and "bus" in (stop.get("modes") or []):
        label += f" → {stop['towards']}"
    if stop.get("crs"):
        label += f" · {stop['crs']}"
    lines = lines_text(stop)
    return label + (f"      {lines}" if lines else "")


def stop_subentry(stop: dict[str, Any]) -> ConfigSubentryData:
    return ConfigSubentryData(
        data={
            CONF_STOP_ID: stop["id"],
            CONF_STOP_NAME: stop["name"],
            CONF_LETTER: stop.get("letter", ""),
            CONF_TOWARDS: stop.get("towards", ""),
            CONF_MODES: list(stop.get("modes") or []),
            CONF_LINES: list(stop.get("lines") or []),
        },
        subentry_type=SUBENTRY_STOP,
        title=stop_title(stop),
        unique_id=stop["id"],
    )


async def validate_keys(hass: HomeAssistant, api_key: str, nr_key: str) -> dict[str, str]:
    """Errors per field ({} when TfL answers with this key and the National Rail key works)."""
    session = async_get_clientsession(hass)
    try:
        await TflApi(session, api_key).validate()
    except TflAuthError:
        return {CONF_API_KEY: "invalid_auth"}
    except TflConnectionError:
        return {"base": "cannot_connect"}
    except TflError:
        return {"base": "unknown"}
    if nr_key:
        try:
            await NationalRailApi(session, nr_key).validate()
        except TflAuthError:
            return {CONF_NR_KEY: "invalid_nr_auth"}
        except TflConnectionError:
            return {CONF_NR_KEY: "nr_cannot_connect"}
        except TflError:
            return {CONF_NR_KEY: "nr_cannot_connect"}
    return {}


async def search_all(
    hass: HomeAssistant, api: TflApi, query: str, with_national_rail: bool
) -> list[dict[str, Any]]:
    """TfL stops + (with a National Rail key) National Rail stations, stations first."""
    stops: list[dict[str, Any]] = []
    tfl_error: TflError | None = None
    try:
        stops = await api.search_stops(query)
    except TflError as err:
        tfl_error = err
    if with_national_rail:
        await hass.async_add_executor_job(load_stations)
        stops += search_stations(query)
    if tfl_error and not stops:
        raise tfl_error
    return sort_stops(stops, query)


async def search(
    hass: HomeAssistant, api_key: str, nr_key: str, query: str
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Search stops; returns (results, errors)."""
    query = query.strip()
    if len(query) < 3:
        return [], {CONF_QUERY: "query_too_short"}
    try:
        stops = await search_all(hass, TflApi(async_get_clientsession(hass), api_key), query, bool(nr_key))
    except TflAuthError:
        return [], {"base": "invalid_auth"}
    except TflConnectionError:
        return [], {"base": "cannot_connect"}
    except TflError:
        return [], {"base": "unknown"}
    if not stops:
        return [], {CONF_QUERY: "no_stops"}
    return stops[:MAX_RESULTS], {}


def key_schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    d = defaults or {}
    password = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))
    return vol.Schema(
        {
            vol.Optional(CONF_API_KEY, default=d.get(CONF_API_KEY, "")): password,
            vol.Optional(CONF_NR_KEY, default=d.get(CONF_NR_KEY, "")): password,
        }
    )


def keys_from(user_input: dict[str, Any]) -> tuple[str, str]:
    return (user_input.get(CONF_API_KEY) or "").strip(), (user_input.get(CONF_NR_KEY) or "").strip()


def search_schema() -> vol.Schema:
    return vol.Schema({vol.Required(CONF_QUERY): TextSelector()})


def stops_schema(results: dict[str, dict[str, Any]], multiple: bool) -> vol.Schema:
    options = [SelectOptionDict(value=sid, label=stop_label(s)) for sid, s in results.items()]
    key = CONF_STOPS if multiple else CONF_STOP_ID
    return vol.Schema(
        {
            vol.Required(key): SelectSelector(
                SelectSelectorConfig(options=options, multiple=multiple, mode=SelectSelectorMode.LIST)
            )
        }
    )


class DotmatrixConfigFlow(ConfigFlow, domain=DOMAIN):
    """Initial setup."""

    VERSION = 1

    def __init__(self) -> None:
        self._api_key: str = ""
        self._nr_key: str = ""
        self._results: dict[str, dict[str, Any]] = {}
        self._selected: dict[str, dict[str, Any]] = {}

    @classmethod
    @callback
    def async_get_supported_subentry_types(cls, config_entry: ConfigEntry) -> dict[str, type[ConfigSubentryFlow]]:
        return {SUBENTRY_STOP: StopSubentryFlow}

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return DotmatrixOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Step 1: optional TfL app key and optional National Rail key."""
        errors: dict[str, str] = {}
        if user_input is not None:
            api_key, nr_key = keys_from(user_input)
            if not (errors := await validate_keys(self.hass, api_key, nr_key)):
                self._api_key, self._nr_key = api_key, nr_key
                return await self.async_step_start()
        return self.async_show_form(
            step_id="user", data_schema=key_schema(), errors=errors, description_placeholders=PLACEHOLDERS
        )

    async def async_step_start(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Step 2: add stops now, or later from the card editor (live search)."""
        return self.async_show_menu(step_id="start", menu_options=["search", "finish"])

    async def async_step_search(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            stops, errors = await search(self.hass, self._api_key, self._nr_key, user_input[CONF_QUERY])
            if not errors:
                self._results = {s["id"]: s for s in stops}
                return await self.async_step_stops()
        return self.async_show_form(
            step_id="search",
            data_schema=search_schema(),
            errors=errors,
            description_placeholders={"selected": self._selected_text()},
        )

    async def async_step_stops(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            chosen = user_input.get(CONF_STOPS) or []
            if chosen:
                for sid in chosen:
                    self._selected[sid] = self._results[sid]
                return await self.async_step_more()
            errors["base"] = "select_one"
        return self.async_show_form(
            step_id="stops", data_schema=stops_schema(self._results, multiple=True), errors=errors
        )

    async def async_step_more(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return self.async_show_menu(
            step_id="more",
            menu_options=["search", "finish"],
            description_placeholders={"selected": self._selected_text()},
        )

    async def async_step_finish(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        return self.async_create_entry(
            title=ENTRY_TITLE,
            data={CONF_API_KEY: self._api_key, CONF_NR_KEY: self._nr_key},
            subentries=[stop_subentry(s) for s in self._selected.values()],
        )

    def _selected_text(self) -> str:
        if not self._selected:
            return "–"
        return "\n".join(f"• {stop_label(s)}" for s in self._selected.values())

    async def async_step_reauth(self, entry_data: Mapping[str, Any]) -> ConfigFlowResult:
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """The stored key was rejected: ask for a new one (or none)."""
        errors: dict[str, str] = {}
        entry = self._get_reauth_entry()
        if user_input is not None:
            api_key, nr_key = keys_from(user_input)
            if not (errors := await validate_keys(self.hass, api_key, nr_key)):
                return self.async_update_reload_and_abort(
                    entry, data_updates={CONF_API_KEY: api_key, CONF_NR_KEY: nr_key}
                )
        return self.async_show_form(
            step_id="reauth_confirm",
            data_schema=key_schema(dict(entry.data)),
            errors=errors,
            description_placeholders=PLACEHOLDERS,
        )

    async def async_step_reconfigure(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        """Add, change or remove the app_key."""
        errors: dict[str, str] = {}
        entry = self._get_reconfigure_entry()
        if user_input is not None:
            api_key, nr_key = keys_from(user_input)
            if not (errors := await validate_keys(self.hass, api_key, nr_key)):
                return self.async_update_reload_and_abort(
                    entry, data_updates={CONF_API_KEY: api_key, CONF_NR_KEY: nr_key}
                )
        return self.async_show_form(
            step_id="reconfigure",
            data_schema=key_schema(dict(entry.data)),
            errors=errors,
            description_placeholders=PLACEHOLDERS,
        )


class StopSubentryFlow(ConfigSubentryFlow):
    """'Add stop' button on the integration page."""

    def __init__(self) -> None:
        self._results: dict[str, dict[str, Any]] = {}

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            entry = self._get_entry()
            stops, errors = await search(
                self.hass, entry.data.get(CONF_API_KEY, ""), entry.data.get(CONF_NR_KEY, ""), user_input[CONF_QUERY]
            )
            if not errors:
                existing = {s.unique_id for s in entry.subentries.values()}
                self._results = {s["id"]: s for s in stops if s["id"] not in existing}
                if self._results:
                    return await self.async_step_pick()
                errors[CONF_QUERY] = "all_added"
        return self.async_show_form(step_id="user", data_schema=search_schema(), errors=errors)

    async def async_step_pick(self, user_input: dict[str, Any] | None = None) -> SubentryFlowResult:
        if user_input is not None:
            data = stop_subentry(self._results[user_input[CONF_STOP_ID]])
            return self.async_create_entry(title=data["title"], data=data["data"], unique_id=data["unique_id"])
        return self.async_show_form(step_id="pick", data_schema=stops_schema(self._results, multiple=False))


class DotmatrixOptionsFlow(OptionsFlow):
    """Polling interval and number of departures kept."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data={k: int(v) for k, v in user_input.items()})

        opts = self.config_entry.options

        def num(minimum: int, maximum: int, unit: str | None) -> NumberSelector:
            config = NumberSelectorConfig(min=minimum, max=maximum, step=1, mode=NumberSelectorMode.BOX)
            if unit:
                config["unit_of_measurement"] = unit
            return NumberSelector(config)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_SCAN_INTERVAL, default=opts.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL)
                    ): num(MIN_SCAN_INTERVAL, MAX_SCAN_INTERVAL, "s"),
                    vol.Required(
                        CONF_MAX_DEPARTURES, default=opts.get(CONF_MAX_DEPARTURES, DEFAULT_MAX_DEPARTURES)
                    ): num(1, 60, None),
                }
            ),
        )
