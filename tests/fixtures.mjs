// Shapes copied from real sensor attributes (built from live TfL responses, Nov 2026).
export function attrs(kind, now = Date.now() / 1000) {
  const dep = (line, line_name, mode, destination, platform, sec, color, direction = "outbound") =>
    ({ line, line_name, mode, destination, platform, direction, expected: Math.round(now + sec), minutes: Math.floor(sec / 60), color, vehicle: "", location: "" });
  if (kind === "tube") return {
    stop_id: "940GZZLUOXC", stop_name: "Oxford Circus", letter: "", towards: "", modes: ["tube"],
    lines: [{ id: "bakerloo", name: "Bakerloo", mode: "tube", color: "#B36305" }, { id: "central", name: "Central", mode: "tube", color: "#E32017" }, { id: "victoria", name: "Victoria", mode: "tube", color: "#0098D4" }],
    departures: [
      dep("central", "Central", "tube", "Hainault via Newbury Park", "Eastbound - Platform 2", 25, "#E32017"),
      dep("central", "Central", "tube", "Epping", "Eastbound - Platform 2", 160, "#E32017"),
      dep("central", "Central", "tube", "Woodford via Hainault", "Eastbound - Platform 2", 400, "#E32017"),
      dep("central", "Central", "tube", "Loughton", "Eastbound - Platform 2", 600, "#E32017"),
      dep("victoria", "Victoria", "tube", "Walthamstow Central", "Northbound - Platform 6", 48, "#0098D4"),
      dep("victoria", "Victoria", "tube", "Seven Sisters", "Northbound - Platform 6", 230, "#0098D4"),
      dep("victoria", "Victoria", "tube", "Walthamstow Central", "Northbound - Platform 6", 360, "#0098D4"),
    ],
    line_status: [{ line: "victoria", name: "Victoria", severity: 9, description: "Minor Delays", reason: "Victoria Line: Minor delays due to train cancellations." }],
  };
  if (kind === "bus") return {
    stop_id: "490000173RC", stop_name: "Oxford Circus Station", letter: "RC", towards: "Marble Arch Or Great Portland Street", modes: ["bus"],
    lines: [{ id: "12", name: "12", mode: "bus", color: "#DC241F" }, { id: "88", name: "88", mode: "bus", color: "#DC241F" }, { id: "n3", name: "N3", mode: "bus", color: "#DC241F" }],
    departures: [
      dep("88", "88", "bus", "Clapham Common", "", 40, "#DC241F"),
      dep("12", "12", "bus", "Dulwich Library", "", 190, "#DC241F"),
      dep("159", "159", "bus", "Streatham Station", "", 420, "#DC241F"),
      dep("94", "94", "bus", "Piccadilly Circus", "", 610, "#DC241F"),
      dep("n3", "N3", "bus", "Bromley North", "", 1300, "#DC241F"),
    ],
    line_status: [{ line: "12", name: "12", severity: 0, description: "Special Service", reason: "HAYMARKET, SW1: Route 12 is diverted via Regent Street." }],
  };
  if (kind === "nr") {
    const hhmm = (sec) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date((now + sec) * 1000));
    const nr = (op, code, dest, plat, sec, status, calling = [], extra = {}) =>
      ({ line: code, line_name: op, mode: "national-rail", destination: dest, platform: plat, direction: "", expected: Math.round(now + sec), scheduled: hhmm(sec), status, cancelled: status === "Cancelled", reason: "", calling_at: calling, minutes: Math.floor(sec / 60), color: "#1E3A8A", vehicle: "", location: "", ...extra });
    return {
      stop_id: "NR:LBG", stop_name: "London Bridge", letter: "", towards: "", modes: ["national-rail"], lines: [], line_status: [],
      messages: ["Disruption between London Bridge and Peckham Rye. Some lines are blocked."],
      departures: [
        nr("Thameslink", "tl", "Bedford", "4", 120, "On time", ["Blackfriars", "City Thameslink", "Farringdon", "St Pancras International", "Luton Airport Parkway", "Luton", "Harlington", "Flitwick", "Bedford"]),
        nr("Southern", "sn", "Brighton", "6", 420, `Exp ${hhmm(660)}`),
        nr("Southeastern", "se", "Dartford via Greenwich", "", 900, "Cancelled"),
        nr("Southeastern", "se", "Hayes", "1", 1100, "On time"),
      ],
    };
  }
  return {
    stop_id: "910GSTFD", stop_name: "Stratford", letter: "", towards: "", modes: ["elizabeth-line", "overground"],
    lines: [{ id: "elizabeth", name: "Elizabeth line", mode: "elizabeth-line", color: "#6950A1" }, { id: "mildmay", name: "Mildmay", mode: "overground", color: "#0077AD" }],
    departures: [
      dep("elizabeth", "Elizabeth line", "elizabeth-line", "Shenfield", "Platform 5", 70, "#6950A1"),
      dep("mildmay", "Mildmay", "overground", "Richmond", "Platform 1", 200, "#0077AD"),
      dep("elizabeth", "Elizabeth line", "elizabeth-line", "Heathrow Terminal 5", "Platform 8", 330, "#6950A1"),
      dep("elizabeth", "Elizabeth line", "elizabeth-line", "Abbey Wood", "Platform 8", 500, "#6950A1"),
    ],
    line_status: [{ line: "mildmay", name: "Mildmay", severity: 6, description: "Severe Delays", reason: "Mildmay line: severe delays between Stratford and Highbury & Islington." }],
  };
}
