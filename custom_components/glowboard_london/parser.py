"""Pure helpers that turn TfL Unified API JSON into small, card-friendly dicts."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from .const import (
    GROUP_TYPES,
    LIGHT_LINES,
    LINE_COLORS,
    MODE_COLORS,
    MODE_ORDER,
    PICKABLE_TYPES,
    TFL_MODES,
)

_SUFFIXES = re.compile(
    r"\s+(underground station|dlr station|rail station|tram stop|station \(london\)|"
    r"\(london\) rail station|elizabeth line station|overground station)$",
    re.IGNORECASE,
)
_SPACES = re.compile(r"\s+")
_NO_TOWARDS = {"", "null", "check front of train", "check front of the train"}
_NO_PLATFORM = {"", "null", "platform unknown", "unknown"}


def clean_name(name: str | None) -> str:
    """'Hainault Underground Station' -> 'Hainault' (real boards never show the suffix)."""
    if not name:
        return ""
    name = _SPACES.sub(" ", str(name)).strip()
    for _ in range(2):
        name = _SUFFIXES.sub("", name).strip()
    return name


def clean_platform(platform: str | None) -> str:
    platform = _SPACES.sub(" ", str(platform or "")).strip()
    return "" if platform.lower() in _NO_PLATFORM else platform


def line_color(line_id: str, mode: str) -> str:
    if mode == "bus":
        return MODE_COLORS["bus"]
    return LINE_COLORS.get(line_id) or MODE_COLORS.get(mode, "#888888")


def text_color(line_id: str) -> str:
    return "#000000" if line_id in LIGHT_LINES else "#FFFFFF"


def _towards(node: dict[str, Any]) -> str:
    for prop in node.get("additionalProperties") or []:
        if prop.get("key") == "Towards" and prop.get("value"):
            return str(prop["value"]).strip()
    return ""


def _node_lines(node: dict[str, Any]) -> list[dict[str, str]]:
    """Lines serving a stop point, TfL modes only, with their colours."""
    mode_of: dict[str, str] = {}
    for group in node.get("lineModeGroups") or []:
        for line_id in group.get("lineIdentifier") or []:
            mode_of[str(line_id).lower()] = group.get("modeName", "")
    names = {str(line.get("id", "")).lower(): line.get("name", "") for line in node.get("lines") or []}
    naptan = str(node.get("naptanId") or node.get("id") or "")
    lines = []
    for line_id in dict.fromkeys([*mode_of, *names]):
        mode = mode_of.get(line_id) or ("bus" if naptan.startswith("490") else "")
        if mode not in TFL_MODES:
            continue
        lines.append(
            {
                "id": line_id,
                "name": names.get(line_id) or line_id.upper(),
                "mode": mode,
                "color": line_color(line_id, mode),
                "text_color": text_color(line_id),
            }
        )
    return lines


def normalize_stop(node: dict[str, Any], fallback_towards: str = "") -> dict[str, Any] | None:
    """A pickable stop point -> {'id', 'name', 'letter', 'towards', 'modes', 'lines'} (None if no TfL service)."""
    stop_id = str(node.get("naptanId") or node.get("id") or "")
    if not stop_id:
        return None
    lines = _node_lines(node)
    modes = list(dict.fromkeys(line["mode"] for line in lines))
    if stop_id.startswith("490") and "bus" not in modes:
        modes.append("bus")
    modes = [m for m in modes if m in TFL_MODES]
    if not modes:
        return None  # e.g. a National Rail-only station
    letter = str(node.get("stopLetter") or "").strip()
    if letter.startswith("->"):
        letter = ""
    return {
        "id": stop_id,
        "name": clean_name(node.get("commonName") or node.get("name")),
        "letter": letter,
        "towards": _towards(node) or fallback_towards,
        "modes": sorted(modes, key=lambda m: MODE_ORDER.get(m, 99)),
        "lines": sorted(lines, key=lambda l: (MODE_ORDER.get(l["mode"], 99), _natural(l["name"]))),
    }


def _natural(text: str) -> tuple:
    return tuple(int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", text))


def collect_stops(details: list[dict[str, Any]], towards: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Walk stop point trees; hubs and bus stations expand into the stops below them."""
    towards = towards or {}
    found: dict[str, dict[str, Any]] = {}

    def walk(node: dict[str, Any], depth: int = 0) -> None:
        stop_type = node.get("stopType")
        if stop_type in PICKABLE_TYPES:
            stop_id = str(node.get("naptanId") or node.get("id") or "")
            if stop_id not in found and (stop := normalize_stop(node, towards.get(stop_id, ""))):
                found[stop_id] = stop
            return
        if stop_type in GROUP_TYPES and depth < 4:
            for child in node.get("children") or []:
                walk(child, depth + 1)

    for node in details:
        walk(node)
    return list(found.values())


def sort_stops(stops: list[dict[str, Any]], query: str) -> list[dict[str, Any]]:
    """Stations first, then bus stops; names that start with the query first."""
    q = query.strip().lower()

    def key(stop: dict[str, Any]) -> tuple:
        name = stop["name"].lower()
        return (
            MODE_ORDER.get(stop["modes"][0], 99) if stop["modes"] else 99,
            0 if name.startswith(q) else 1 if q in name else 2,
            name,
            stop["letter"],
        )

    return sorted(stops, key=key)


def _timestamp(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def destination(arrival: dict[str, Any]) -> str:
    """Rider-facing destination text.

    Tube: TfL's `towards` already reads like the board ('Hainault via Newbury Park'),
    `destinationName` alone would lose the branch. Buses: `towards` is the stop's general
    direction, so the destination name is the right one.
    """
    mode = arrival.get("modeName")
    towards = str(arrival.get("towards") or "").strip()
    dest = clean_name(arrival.get("destinationName"))
    if mode == "tube" and towards.lower() not in _NO_TOWARDS:
        return clean_name(towards)
    if dest:
        return dest
    if towards.lower() not in _NO_TOWARDS:
        return clean_name(towards)
    return "Check front of train"


def parse_arrivals(raw: list[dict[str, Any]], now: float) -> list[dict[str, Any]]:
    """Arrival predictions -> sorted list of departures with an absolute `expected` unix time."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for arrival in raw or []:
        mode = arrival.get("modeName", "")
        if mode not in TFL_MODES:
            continue
        line_id = str(arrival.get("lineId") or "").lower()
        platform = clean_platform(arrival.get("platformName"))
        vehicle = str(arrival.get("vehicleId") or "")
        key = str(arrival.get("id") or f"{line_id}|{vehicle}|{platform}|{arrival.get('expectedArrival')}")
        if key in seen:
            continue
        seen.add(key)
        expected = _timestamp(arrival.get("expectedArrival"))
        if expected is None:
            expected = now + float(arrival.get("timeToStation") or 0)
        if expected < now - 60:
            continue
        out.append(
            {
                "line": line_id,
                "line_name": str(arrival.get("lineName") or line_id),
                "mode": mode,
                "destination": destination(arrival),
                "platform": platform if mode != "bus" else "",
                "direction": str(arrival.get("direction") or ""),
                "expected": int(round(expected)),
                "minutes": max(0, int((expected - now) // 60)),
                "color": line_color(line_id, mode),
                "vehicle": vehicle,
                "location": str(arrival.get("currentLocation") or ""),
            }
        )
    out.sort(key=lambda d: (d["expected"], d["destination"]))
    return out


def parse_line_status(raw: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """GET /Line/{ids}/Status -> {line_id: {'name', 'severity', 'description', 'reason'}} (worst status)."""
    out: dict[str, dict[str, Any]] = {}
    for line in raw or []:
        statuses = line.get("lineStatuses") or []
        if not statuses:
            continue
        worst = min(statuses, key=lambda s: s.get("statusSeverity", 10))
        reason = _SPACES.sub(" ", str(worst.get("reason") or "")).strip()
        out[str(line.get("id", "")).lower()] = {
            "line": str(line.get("id", "")).lower(),
            "name": line.get("name", ""),
            "severity": int(worst.get("statusSeverity", 10)),
            "description": worst.get("statusSeverityDescription", ""),
            "reason": reason,
        }
    return out
