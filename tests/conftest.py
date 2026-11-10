"""Fixtures (shapes taken from real TfL Unified API responses, Nov 2026)."""

from __future__ import annotations

import time

import pytest

pytest_plugins = ["pytest_homeassistant_custom_component"]

NOW = float(int(time.time()))


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    yield


def iso(seconds_from_now: float) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(NOW + seconds_from_now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def arrival(**kw):
    base = {
        "id": "1",
        "naptanId": "940GZZLUOXC",
        "stationName": "Oxford Circus Underground Station",
        "lineId": "central",
        "lineName": "Central",
        "platformName": "Eastbound - Platform 2",
        "direction": "outbound",
        "destinationName": "Hainault Underground Station",
        "towards": "Hainault via Newbury Park",
        "timeToStation": 30,
        "expectedArrival": iso(30),
        "modeName": "tube",
        "vehicleId": "056",
        "currentLocation": "At Platform",
    }
    base.update(kw)
    return base


@pytest.fixture
def tube_arrivals():
    return [
        arrival(id="3", towards="Epping", destinationName="Epping Underground Station", timeToStation=160, expectedArrival=iso(160)),
        arrival(id="1"),
        arrival(id="1"),  # TfL sometimes repeats a prediction
        arrival(id="2", lineId="victoria", lineName="Victoria", platformName="Northbound - Platform 6",
                towards="Check Front of Train", destinationName="Walthamstow Central Underground Station",
                timeToStation=48, expectedArrival=iso(48)),
        arrival(id="4", timeToStation=-200, expectedArrival=iso(-200)),  # long gone
    ]


@pytest.fixture
def bus_arrivals():
    return [
        arrival(id="b1", naptanId="490000173RC", lineId="12", lineName="12", platformName="RC", direction="inbound",
                destinationName="Dulwich Library", towards="Baker Street Or Great Portand Street",
                timeToStation=200, expectedArrival=iso(200), modeName="bus", vehicleId="LTZ1876"),
    ]


def stop_point(naptan, name, stop_type, groups, lines=None, children=None, letter=None, towards=None):
    sp = {
        "naptanId": naptan,
        "commonName": name,
        "stopType": stop_type,
        "lineModeGroups": [{"modeName": m, "lineIdentifier": ids} for m, ids in groups],
        "lines": [{"id": i, "name": n} for i, n in (lines or [])],
        "children": children or [],
        "additionalProperties": [{"key": "Towards", "value": towards}] if towards else [],
    }
    if letter:
        sp["stopLetter"] = letter
    return sp


@pytest.fixture
def stratford_hub():
    return stop_point(
        "HUBSRA", "Stratford", "TransportInterchange", [("bus", ["25"]), ("national-rail", ["c2c"])],
        children=[
            stop_point("910GSTFD", "Stratford (London) Rail Station", "NaptanRailStation",
                       [("elizabeth-line", ["elizabeth"]), ("overground", ["mildmay"]), ("national-rail", ["c2c"])],
                       [("elizabeth", "Elizabeth line"), ("mildmay", "Mildmay"), ("c2c", "c2c")]),
            stop_point("940GZZLUSTD", "Stratford Underground Station", "NaptanMetroStation",
                       [("tube", ["central", "jubilee"])], [("central", "Central"), ("jubilee", "Jubilee")]),
            stop_point("490G000773", "Stratford Bus Station", "NaptanBusCoachStation", [("bus", ["25"])], children=[
                stop_point("490000226R", "Stratford Bus Station", "NaptanPublicBusCoachTram", [("bus", ["25", "n25"])],
                           [("25", "25"), ("n25", "N25")], letter="R", towards="Bow Church"),
            ]),
            stop_point("910GSTFDNR", "Stratford NR only", "NaptanRailStation", [("national-rail", ["c2c"])]),
        ],
    )


@pytest.fixture
def nr_board():
    """GetDepBoardWithDetails response (field names from the official LDBWS contract)."""
    from datetime import datetime, timedelta
    from zoneinfo import ZoneInfo

    london = datetime.fromtimestamp(NOW, ZoneInfo("Europe/London"))
    hhmm = lambda minutes: (london + timedelta(minutes=minutes)).strftime("%H:%M")  # noqa: E731
    return {
        "generatedAt": "2026-11-10T10:00:00Z",
        "locationName": "London Bridge",
        "crs": "LBG",
        "platformAvailable": True,
        "nrccMessages": [{"Value": "<p>Disruption between A and B.</p>"}],
        "trainServices": [
            {
                "std": hhmm(20), "etd": hhmm(24), "platform": "6", "operator": "Southern", "operatorCode": "SN",
                "isCancelled": False, "serviceID": "B", "delayReason": "This train has been delayed by a signalling fault",
                "destination": [{"locationName": "Brighton", "crs": "BTN"}],
                "subsequentCallingPoints": [{"callingPoint": [{"locationName": "East Croydon", "st": hhmm(32), "et": "On time"}]}],
            },
            {
                "std": hhmm(5), "etd": "On time", "platform": "4", "operator": "Thameslink", "operatorCode": "TL",
                "isCancelled": False, "serviceID": "A",
                "destination": [{"locationName": "Bedford", "crs": "BDM"}],
                "subsequentCallingPoints": [{"callingPoint": [
                    {"locationName": "Blackfriars", "st": hhmm(8), "et": "On time"},
                    {"locationName": "City Thameslink", "st": hhmm(10), "et": "On time"},
                    {"locationName": "Farringdon", "st": hhmm(12), "et": "On time"},
                ]}],
            },
            {
                "std": hhmm(30), "etd": "Cancelled", "operator": "Southeastern", "operatorCode": "SE", "isCancelled": True,
                "cancelReason": "This train has been cancelled because of a shortage of train crew",
                "destination": [{"locationName": "Dartford", "crs": "DFD", "via": "via Greenwich"}],
            },
        ],
    }
