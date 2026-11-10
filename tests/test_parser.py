"""Pure parser tests."""

from custom_components.london_dotmatrix.parser import (
    clean_name,
    collect_stops,
    parse_arrivals,
    parse_line_status,
    sort_stops,
)

from .conftest import NOW


def test_clean_name():
    assert clean_name("Hainault Underground Station") == "Hainault"
    assert clean_name("Stratford (London) Rail Station") == "Stratford"
    assert clean_name("Wimbledon Tram Stop") == "Wimbledon"
    assert clean_name("Bank DLR Station") == "Bank"
    assert clean_name("Greenwich Pier") == "Greenwich Pier"
    assert clean_name(None) == ""


def test_parse_tube_arrivals(tube_arrivals):
    deps = parse_arrivals(tube_arrivals, NOW)
    assert [d["destination"] for d in deps] == ["Hainault via Newbury Park", "Walthamstow Central", "Epping"]
    first = deps[0]
    assert first["expected"] == int(NOW + 30)
    assert first["platform"] == "Eastbound - Platform 2"
    assert first["color"] == "#E32017"
    assert first["minutes"] == 0


def test_parse_bus_arrivals(bus_arrivals):
    (dep,) = parse_arrivals(bus_arrivals, NOW)
    # bus 'towards' is the stop's direction, not the destination
    assert dep["destination"] == "Dulwich Library"
    assert dep["platform"] == ""
    assert dep["line_name"] == "12"
    assert dep["color"] == "#DC241F"
    assert dep["minutes"] == 3


def test_collect_stops_expands_hubs(stratford_hub):
    stops = sort_stops(collect_stops([stratford_hub], {"490000226R": "x"}), "stratford")
    ids = [s["id"] for s in stops]
    # national rail only station dropped, bus station expanded to its stop, tube first
    assert ids == ["940GZZLUSTD", "910GSTFD", "490000226R"]
    rail = stops[1]
    assert rail["name"] == "Stratford"
    assert rail["modes"] == ["elizabeth-line", "overground"]
    assert [l["id"] for l in rail["lines"]] == ["elizabeth", "mildmay"]
    bus = stops[2]
    assert bus["letter"] == "R" and bus["towards"] == "Bow Church"
    assert [l["name"] for l in bus["lines"]] == ["25", "N25"]


def test_line_status():
    status = parse_line_status([
        {"id": "victoria", "name": "Victoria", "lineStatuses": [
            {"statusSeverity": 10, "statusSeverityDescription": "Good Service"},
            {"statusSeverity": 9, "statusSeverityDescription": "Minor Delays", "reason": "Victoria Line:  Minor delays. "},
        ]},
    ])
    assert status["victoria"]["severity"] == 9
    assert status["victoria"]["reason"] == "Victoria Line: Minor delays."


def test_national_rail_board(nr_board):
    from datetime import datetime, timezone

    from custom_components.london_dotmatrix.national_rail import parse_board

    parsed = parse_board(nr_board, datetime.fromtimestamp(NOW, timezone.utc))
    deps = parsed["departures"]
    assert [d["destination"] for d in deps] == ["Bedford", "Brighton", "Dartford via Greenwich"]
    assert [d["status"] for d in deps] == ["On time", f"Exp {nr_board['trainServices'][0]['etd']}", "Cancelled"]
    assert 23 * 60 <= deps[1]["expected"] - NOW <= 24 * 60 and deps[1]["reason"].startswith("This train has been delayed")
    assert deps[0]["mode"] == "national-rail" and deps[0]["scheduled"] == nr_board["trainServices"][1]["std"]
    assert parsed["messages"] == ["Disruption between A and B."]


def test_national_rail_station_search():
    from custom_components.london_dotmatrix.national_rail import load_stations, search_stations

    load_stations()
    assert search_stations("London Bridge")[0]["id"] == "NR:LBG"
    assert search_stations("kgx")[0]["name"] == "London Kings Cross"
    assert all(s["modes"] == ["national-rail"] for s in search_stations("Brighton"))
    assert search_stations("zz") == []
