"""Config flow, subentry flow, sensor, websocket and frontend tests with a mocked TfL API."""

from unittest.mock import AsyncMock, patch

from homeassistant import config_entries
from homeassistant.config_entries import ConfigEntryState, ConfigSubentryData
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.london_dotmatrix.api import TflAuthError, TflConnectionError
from custom_components.london_dotmatrix.const import DOMAIN
from custom_components.london_dotmatrix.parser import parse_arrivals

from .conftest import NOW

API = "custom_components.london_dotmatrix.api.TflApi"
LINE = lambda i, n, m, c="#E32017": {"id": i, "name": n, "mode": m, "color": c, "text_color": "#FFFFFF"}  # noqa: E731
STOPS = [
    {"id": "940GZZLUOXC", "name": "Oxford Circus", "letter": "", "towards": "", "modes": ["tube"],
     "lines": [LINE("central", "Central", "tube"), LINE("victoria", "Victoria", "tube", "#0098D4")]},
    {"id": "490000173RC", "name": "Oxford Circus Station", "letter": "RC", "towards": "Marble Arch", "modes": ["bus"],
     "lines": [LINE("12", "12", "bus", "#DC241F")]},
]


def sub(stop):
    return ConfigSubentryData(
        data={"stop_id": stop["id"], "stop_name": stop["name"], "letter": stop["letter"], "towards": stop["towards"],
              "modes": stop["modes"], "lines": stop["lines"]},
        subentry_type="stop", title=stop["name"], unique_id=stop["id"],
    )


async def test_full_flow_without_key(hass: HomeAssistant):
    with patch(f"{API}.validate", AsyncMock()), patch(f"{API}.search_stops", AsyncMock(return_value=STOPS)):
        result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
        assert result["step_id"] == "user"
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {})
        assert result["type"] is FlowResultType.MENU and result["step_id"] == "start"
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "search"})
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"query": "ox"})
        assert result["errors"] == {"query": "query_too_short"}
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"query": "Oxford Circus"})
        assert result["step_id"] == "stops"
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"stops": []})
        assert result["errors"] == {"base": "select_one"}
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"stops": ["940GZZLUOXC", "490000173RC"]})
        assert result["type"] is FlowResultType.MENU
        with patch("custom_components.london_dotmatrix.async_setup_entry", AsyncMock(return_value=True)):
            result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "finish"})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {"api_key": "", "nr_api_key": ""}
    titles = sorted(s.title for s in result["result"].subentries.values())
    assert titles == ["Oxford Circus", "Oxford Circus Station (Stop RC)"]


async def test_bad_key_and_connection(hass: HomeAssistant):
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    with patch(f"{API}.validate", AsyncMock(side_effect=TflAuthError)):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"api_key": "nope"})
    assert result["errors"] == {"api_key": "invalid_auth"}
    with patch(f"{API}.validate", AsyncMock(side_effect=TflConnectionError)):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"api_key": "x"})
    assert result["errors"] == {"base": "cannot_connect"}
    with patch(f"{API}.validate", AsyncMock()):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"api_key": " key "})
    assert result["step_id"] == "start"


async def test_single_instance(hass: HomeAssistant):
    MockConfigEntry(domain=DOMAIN, data={"api_key": ""}).add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT and result["reason"] == "single_instance_allowed"


async def setup_entry(hass, tube_arrivals, bus_arrivals, stops=STOPS):
    entry = MockConfigEntry(domain=DOMAIN, data={"api_key": "k"}, subentries_data=[sub(s) for s in stops])
    entry.add_to_hass(hass)

    async def arrivals(self, stop_id):
        return bus_arrivals if stop_id.startswith("490") else tube_arrivals

    status = {"victoria": {"line": "victoria", "name": "Victoria", "severity": 9, "description": "Minor Delays", "reason": "Delays"}}
    with patch(f"{API}.arrivals", arrivals), patch(f"{API}.line_status", AsyncMock(return_value=status)), \
         patch("custom_components.london_dotmatrix.parser.parse_arrivals", parse_arrivals), \
         patch("custom_components.london_dotmatrix.coordinator.time.time", return_value=NOW):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    return entry


async def test_sensors(hass: HomeAssistant, tube_arrivals, bus_arrivals):
    await async_setup_component(hass, "http", {})
    entry = await setup_entry(hass, tube_arrivals, bus_arrivals)
    assert entry.state is ConfigEntryState.LOADED
    tube = hass.states.get("sensor.oxford_circus_next_arrival")
    bus = hass.states.get("sensor.oxford_circus_station_next_arrival")
    assert tube is not None and bus is not None, hass.states.async_entity_ids("sensor")
    a = tube.attributes
    assert a["stop_id"] == "940GZZLUOXC" and a["modes"] == ["tube"]
    assert [d["destination"] for d in a["departures"]][:2] == ["Hainault via Newbury Park", "Walthamstow Central"]
    assert a["line_status"][0]["line"] == "victoria"
    assert bus.attributes["letter"] == "RC"
    assert bus.attributes["departures"][0]["destination"] == "Dulwich Library"


async def test_auth_failure_starts_reauth(hass: HomeAssistant):
    entry = MockConfigEntry(domain=DOMAIN, data={"api_key": "bad"}, subentries_data=[sub(STOPS[0])])
    entry.add_to_hass(hass)
    with patch(f"{API}.arrivals", AsyncMock(side_effect=TflAuthError)):
        await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_ERROR
    flows = hass.config_entries.flow.async_progress()
    assert any(f["context"]["source"] == "reauth" for f in flows)


async def test_subentry_flow(hass: HomeAssistant, tube_arrivals, bus_arrivals):
    entry = await setup_entry(hass, tube_arrivals, bus_arrivals, stops=[STOPS[0]])
    with patch(f"{API}.search_stops", AsyncMock(return_value=STOPS)):
        result = await hass.config_entries.subentries.async_init((entry.entry_id, "stop"), context={"source": "user"})
        result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"query": "Oxford"})
    assert result["step_id"] == "pick"
    options = result["data_schema"].schema["stop_id"].config["options"]
    assert [o["value"] for o in options] == ["490000173RC"]  # already added stop hidden
    with patch(f"{API}.arrivals", AsyncMock(return_value=bus_arrivals)), patch(f"{API}.line_status", AsyncMock(return_value={})):
        result = await hass.config_entries.subentries.async_configure(result["flow_id"], {"stop_id": "490000173RC"})
        await hass.async_block_till_done()
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert len(entry.subentries) == 2


async def test_options_flow(hass: HomeAssistant, tube_arrivals, bus_arrivals):
    entry = await setup_entry(hass, tube_arrivals, bus_arrivals, stops=[STOPS[0]])
    result = await hass.config_entries.options.async_init(entry.entry_id)
    with patch(f"{API}.arrivals", AsyncMock(return_value=tube_arrivals)), patch(f"{API}.line_status", AsyncMock(return_value={})):
        result = await hass.config_entries.options.async_configure(result["flow_id"], {"scan_interval": 60, "max_departures": 10})
        await hass.async_block_till_done()
    assert entry.options == {"scan_interval": 60, "max_departures": 10}


async def test_websocket_search_and_add(hass: HomeAssistant, hass_ws_client, tube_arrivals, bus_arrivals):
    await async_setup_component(hass, "http", {})
    entry = await setup_entry(hass, tube_arrivals, bus_arrivals, stops=[STOPS[0]])
    client = await hass_ws_client(hass)
    with patch(f"{API}.search_stops", AsyncMock(return_value=[dict(s) for s in STOPS])):
        await client.send_json({"id": 1, "type": f"{DOMAIN}/search", "query": "Oxford", "modes": ["bus"]})
        res = await client.receive_json()
    assert res["success"], res
    stops = res["result"]["stops"]
    assert [s["id"] for s in stops] == ["490000173RC"] and stops[0]["added"] is False

    with patch(f"{API}.arrivals", AsyncMock(return_value=bus_arrivals)), patch(f"{API}.line_status", AsyncMock(return_value={})):
        await client.send_json({"id": 2, "type": f"{DOMAIN}/add_stop", "stop_id": "490000173RC"})
        res = await client.receive_json()
        await hass.async_block_till_done()
    assert res["success"], res
    assert res["result"]["entity_id"].startswith("sensor.oxford_circus_station")
    assert len(entry.subentries) == 2


async def test_frontend_resource_registered(hass: HomeAssistant, tube_arrivals, bus_arrivals):
    await async_setup_component(hass, "http", {})
    await async_setup_component(hass, "lovelace", {})
    await setup_entry(hass, tube_arrivals, bus_arrivals, stops=[STOPS[0]])
    from homeassistant.components.lovelace import LOVELACE_DATA

    resources = hass.data[LOVELACE_DATA].resources
    urls = [r["url"] for r in resources.async_items()]
    assert len(urls) == 1 and urls[0].startswith("/london_dotmatrix/dotmatrix-cards.js?v=0.2.0-")


NR = "custom_components.london_dotmatrix.national_rail.NationalRailApi"


async def test_flow_with_national_rail_key(hass: HomeAssistant):
    with patch(f"{API}.validate", AsyncMock()), patch(f"{NR}.validate", AsyncMock(side_effect=TflAuthError)):
        result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": config_entries.SOURCE_USER})
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"nr_api_key": "bad"})
    assert result["errors"] == {"nr_api_key": "invalid_nr_auth"}
    with patch(f"{API}.validate", AsyncMock()), patch(f"{NR}.validate", AsyncMock()), \
         patch(f"{API}.search_stops", AsyncMock(return_value=[])):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"nr_api_key": " good "})
        assert result["step_id"] == "start"
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "search"})
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"query": "London Bridge"})
    assert result["step_id"] == "stops"
    options = result["data_schema"].schema["stops"].config["options"]
    assert options[0]["value"] == "NR:LBG"
    assert "London Bridge (National Rail)" in options[0]["label"]
    with patch("custom_components.london_dotmatrix.async_setup_entry", AsyncMock(return_value=True)):
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"stops": ["NR:LBG"]})
        result = await hass.config_entries.flow.async_configure(result["flow_id"], {"next_step_id": "finish"})
    assert result["data"] == {"api_key": "", "nr_api_key": "good"}
    (sub_,) = result["result"].subentries.values()
    assert sub_.data["stop_id"] == "NR:LBG" and sub_.data["modes"] == ["national-rail"]


async def test_national_rail_sensor(hass: HomeAssistant, nr_board):
    stop = {"id": "NR:LBG", "name": "London Bridge", "letter": "", "towards": "", "modes": ["national-rail"], "lines": []}
    entry = MockConfigEntry(domain=DOMAIN, data={"api_key": "", "nr_api_key": "k"}, subentries_data=[sub(stop)])
    entry.add_to_hass(hass)
    with patch(f"{NR}.board", AsyncMock(return_value=nr_board)):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
    state = hass.states.get("sensor.london_bridge_next_arrival")
    assert state is not None, hass.states.async_entity_ids("sensor")
    deps = state.attributes["departures"]
    assert deps[0]["line_name"] == "Thameslink" and deps[0]["platform"] == "4"
    assert deps[0]["calling_at"] == ["Blackfriars", "City Thameslink", "Farringdon"]
    assert state.attributes["messages"] == ["Disruption between A and B."]


async def test_national_rail_without_key(hass: HomeAssistant):
    stop = {"id": "NR:LBG", "name": "London Bridge", "letter": "", "towards": "", "modes": ["national-rail"], "lines": []}
    entry = MockConfigEntry(domain=DOMAIN, data={"api_key": ""}, subentries_data=[sub(stop)])
    entry.add_to_hass(hass)
    await hass.config_entries.async_setup(entry.entry_id)
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.SETUP_RETRY
