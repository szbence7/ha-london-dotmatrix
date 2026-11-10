"""Next-arrival sensor per stop; the full board is in the attributes."""

from __future__ import annotations

import time
from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.const import UnitOfTime
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddConfigEntryEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import (
    ATTRIBUTION,
    CONF_LETTER,
    CONF_LINES,
    CONF_MAX_DEPARTURES,
    CONF_MODES,
    CONF_TOWARDS,
    DEFAULT_MAX_DEPARTURES,
    DOMAIN,
    MODE_NAMES,
)
from .coordinator import DotmatrixConfigEntry, StopCoordinator

MODE_ICON = {
    "tube": "mdi:subway-variant",
    "bus": "mdi:bus-clock",
    "dlr": "mdi:train-variant",
    "overground": "mdi:train",
    "elizabeth-line": "mdi:train",
    "tram": "mdi:tram",
    "river-bus": "mdi:ferry",
    "cable-car": "mdi:gondola",
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: DotmatrixConfigEntry,
    async_add_entities: AddConfigEntryEntitiesCallback,
) -> None:
    """One sensor per stop subentry."""
    for subentry_id, coordinator in entry.runtime_data.coordinators.items():
        async_add_entities([NextArrivalSensor(coordinator)], config_subentry_id=subentry_id)


class NextArrivalSensor(CoordinatorEntity[StopCoordinator], SensorEntity):
    """Minutes until the next arrival at the stop."""

    _attr_has_entity_name = True
    _attr_translation_key = "next_arrival"
    _attr_device_class = SensorDeviceClass.DURATION
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_attribution = ATTRIBUTION
    # The board changes every poll: keep it out of the recorder database.
    _unrecorded_attributes = frozenset({"departures", "line_status", "lines"})

    def __init__(self, coordinator: StopCoordinator) -> None:
        super().__init__(coordinator)
        data = coordinator.subentry.data
        modes = data.get(CONF_MODES) or []
        self._attr_unique_id = f"{coordinator.stop_id}_next_arrival"
        self._attr_icon = MODE_ICON.get(modes[0] if modes else "", "mdi:train-bus")
        letter = data.get(CONF_LETTER)
        towards = data.get(CONF_TOWARDS)
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, coordinator.stop_id)},
            name=coordinator.subentry.title or coordinator.stop_name,
            manufacturer="TfL open data (unofficial)",
            model=" · ".join(
                x
                for x in (
                    ", ".join(MODE_NAMES.get(m, m) for m in modes),
                    f"Stop {letter}" if letter else "",
                    f"towards {towards}" if towards else "",
                )
                if x
            )
            or None,
            serial_number=coordinator.stop_id,
            entry_type=DeviceEntryType.SERVICE,
        )

    @property
    def _departures(self) -> list[dict[str, Any]]:
        now = time.time()
        return [d for d in (self.coordinator.data or {}).get("departures", []) if d["expected"] > now - 30]

    @property
    def native_value(self) -> int | None:
        deps = self._departures
        return max(0, int((deps[0]["expected"] - time.time()) // 60)) if deps else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        limit = self.coordinator.config_entry.options.get(CONF_MAX_DEPARTURES, DEFAULT_MAX_DEPARTURES)
        data = self.coordinator.subentry.data
        status = (self.coordinator.data or {}).get("status", {})
        return {
            "stop_id": self.coordinator.stop_id,
            "stop_name": self.coordinator.stop_name,
            "letter": data.get(CONF_LETTER, ""),
            "towards": data.get(CONF_TOWARDS, ""),
            "modes": data.get(CONF_MODES, []),
            "lines": data.get(CONF_LINES, []),
            "departures": self._departures[:limit],
            "line_status": list(status.values()),
        }
