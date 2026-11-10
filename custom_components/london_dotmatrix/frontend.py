"""Serve and register the bundled dashboard cards (one JS module, three cards)."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from urllib.parse import urlsplit

from homeassistant.components.http import StaticPathConfig
from homeassistant.components.lovelace import LOVELACE_DATA
from homeassistant.components.lovelace.resources import ResourceStorageCollection
from homeassistant.core import HomeAssistant

from .const import DOMAIN, VERSION

_LOGGER = logging.getLogger(__name__)
CARD_FILE = "dotmatrix-cards.js"
CARD_PATH = f"/{DOMAIN}/{CARD_FILE}"
CARD_FILE_PATH = Path(__file__).parent / "www" / CARD_FILE


def _card_url() -> str:
    """Cache-busting URL: changes whenever the bundled cards change, not only on version bumps."""
    digest = hashlib.sha256(CARD_FILE_PATH.read_bytes()).hexdigest()[:10]
    return f"{CARD_PATH}?v={VERSION}-{digest}"


CARD_URL = f"{CARD_PATH}?v={VERSION}"  # replaced by the hashed URL at setup


async def async_setup_frontend(hass: HomeAssistant) -> None:
    """Expose only the bundled cards, never the integration's Python files."""
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_PATH, str(CARD_FILE_PATH), False)]
    )
    global CARD_URL  # noqa: PLW0603
    CARD_URL = await hass.async_add_executor_job(_card_url)
    await async_register_resource(hass)


async def async_register_resource(hass: HomeAssistant) -> None:
    """Create or update the single module resource (cache-busted by version)."""
    lovelace = hass.data.get(LOVELACE_DATA)
    resources = getattr(lovelace, "resources", None)
    if not isinstance(resources, ResourceStorageCollection):
        _LOGGER.warning(
            "Lovelace resources are managed in YAML. Add url: %s with type: module to use the cards", CARD_URL
        )
        return

    # Load the collection before inspecting it, including on a fresh HA startup.
    await resources.async_get_info()
    matches = [item for item in resources.async_items() if urlsplit(item["url"]).path == CARD_PATH]
    if not matches:
        await resources.async_create_item({"res_type": "module", "url": CARD_URL})
        return
    primary = matches[0]
    if primary["url"] != CARD_URL or primary.get("type") != "module":
        await resources.async_update_item(primary["id"], {"res_type": "module", "url": CARD_URL})
    for item in matches[1:]:
        await resources.async_delete_item(item["id"])
