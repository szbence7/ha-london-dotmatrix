"""Constants for London Dotmatrix."""

from __future__ import annotations

DOMAIN = "london_dotmatrix"
VERSION = "0.2.0"

API_BASE = "https://api.tfl.gov.uk"
API_KEY_URL = "https://api-portal.tfl.gov.uk"
NR_KEY_URL = "https://raildata.org.uk"

CONF_NR_KEY = "nr_api_key"

CONF_STOP_ID = "stop_id"
CONF_STOP_NAME = "stop_name"
CONF_LETTER = "letter"
CONF_TOWARDS = "towards"
CONF_MODES = "modes"
CONF_LINES = "lines"
CONF_QUERY = "query"
CONF_STOPS = "stops"

CONF_SCAN_INTERVAL = "scan_interval"
CONF_MAX_DEPARTURES = "max_departures"

DEFAULT_SCAN_INTERVAL = 30  # seconds
MIN_SCAN_INTERVAL = 15
MAX_SCAN_INTERVAL = 300
DEFAULT_MAX_DEPARTURES = 30
STATUS_TTL = 120  # line status (disruptions) is refreshed at most this often

SUBENTRY_STOP = "stop"

ATTRIBUTION = (
    "Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016 "
    "and Geomni UK Map data © and database rights [2019]"
)
NR_ATTRIBUTION = "Powered by National Rail Enquiries"

# Every TfL mode that has live arrival predictions (national rail needs Darwin, not covered).
TFL_MODES = (
    "tube",
    "bus",
    "dlr",
    "overground",
    "elizabeth-line",
    "tram",
    "river-bus",
    "cable-car",
)

MODE_NAMES = {
    "tube": "Underground",
    "bus": "Bus",
    "dlr": "DLR",
    "overground": "Overground",
    "elizabeth-line": "Elizabeth line",
    "tram": "Tram",
    "river-bus": "River Bus",
    "cable-car": "Cable Car",
    "national-rail": "National Rail",
}

MODE_ICONS = {
    "tube": "🚇",
    "bus": "🚌",
    "dlr": "🚈",
    "overground": "🚆",
    "elizabeth-line": "🚄",
    "tram": "🚊",
    "river-bus": "⛴️",
    "cable-car": "🚡",
    "national-rail": "🚉",
}

# Mode order used to sort search results (stations before bus stops).
MODE_ORDER = {mode: i for i, mode in enumerate(
    ("tube", "elizabeth-line", "overground", "dlr", "national-rail", "tram", "cable-car", "river-bus", "bus")
)}

MODE_COLORS = {
    "tube": "#0019A8",
    "bus": "#DC241F",
    "dlr": "#00A4A7",
    "overground": "#EE7C0E",
    "elizabeth-line": "#6950A1",
    "tram": "#5FB526",
    "river-bus": "#0099CC",
    "cable-car": "#E21836",
    "national-rail": "#1E3A8A",
}

LINE_COLORS = {
    "bakerloo": "#B36305",
    "central": "#E32017",
    "circle": "#FFD300",
    "district": "#00782A",
    "hammersmith-city": "#F3A9BB",
    "jubilee": "#A0A5A9",
    "metropolitan": "#9B0056",
    "northern": "#000000",
    "piccadilly": "#003688",
    "victoria": "#0098D4",
    "waterloo-city": "#95CDBA",
    "dlr": "#00A4A7",
    "elizabeth": "#6950A1",
    "liberty": "#5D6061",
    "lioness": "#FAA61A",
    "mildmay": "#0077AD",
    "suffragette": "#5BB972",
    "weaver": "#823A62",
    "windrush": "#ED1B00",
    "tram": "#5FB526",
    "london-cable-car": "#E21836",
}

# Text colour on top of a line colour badge.
LIGHT_LINES = {"circle", "hammersmith-city", "jubilee", "waterloo-city", "lioness"}

# Stop point types a user can pick (they have live arrivals) …
PICKABLE_TYPES = {
    "NaptanMetroStation",
    "NaptanRailStation",
    "NaptanPublicBusCoachTram",
    "NaptanFerryPort",
}
# … and types that only group other stop points (expanded to their children).
GROUP_TYPES = {
    "TransportInterchange",
    "NaptanBusCoachStation",
    "NaptanOnstreetBusCoachStopPair",
}
