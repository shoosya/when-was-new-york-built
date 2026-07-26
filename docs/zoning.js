// Plain-language labels for NYC zoning codes (PLUTO's zonedist1 field).
//
// There are 200+ exact codes, but they follow a simple pattern:
//   letter      = use     (R residential, C commercial, M manufacturing)
//   first number = density (higher number = denser / taller allowed)
//   suffixes & dashes = fine-grained variants we don't need for a popup.
// So rather than list every code, we read those two parts and describe them.

const ZONING_DENSITY = {
  R: {
    1: "single-family houses",
    2: "single-family houses",
    3: "low-rise houses",
    4: "houses & small apartments",
    5: "low-rise apartments",
    6: "mid-rise apartments",
    7: "mid-rise apartments",
    8: "high-rise apartments",
    9: "high-rise apartments",
    10: "high-rise apartments",
  },
  C: {
    1: "local retail & housing",
    2: "local retail & housing",
    3: "waterfront recreation",
    4: "regional shopping",
    5: "high-density commercial & offices",
    6: "high-density commercial & offices",
    7: "commercial amusement",
    8: "auto & heavy commercial",
  },
  M: {
    1: "light manufacturing",
    2: "medium manufacturing",
    3: "heavy manufacturing",
  },
};

// Fallback wording if we know the use letter but not the density number.
const ZONING_USE = { R: "residential", C: "commercial", M: "manufacturing" };

// "R7A" -> "R7A — mid-rise apartments"; the raw code if we can't interpret it.
function zoningLabel(code) {
  if (!code) return "zoning n/a";

  // A few named districts that don't follow the letter+number pattern.
  if (code === "PARK" || code === "PARKS") return `${code} — parkland`;
  if (code === "BPC") return "BPC — Battery Park City";

  // Special Mixed-Use districts pair a manufacturing and a residential code,
  // e.g. "M1-2/R6A" — homes and light industry side by side.
  if (code.includes("/")) return `${code} — mixed homes & light industry`;

  // Pull the use letter and the first density number out of the code.
  const match = code.match(/^([A-Z])(\d+)/);
  if (!match) return code;

  const use = match[1];
  const density = parseInt(match[2], 10);
  const description = ZONING_DENSITY[use] && ZONING_DENSITY[use][density];

  if (description) return `${code} — ${description}`;
  if (ZONING_USE[use]) return `${code} — ${ZONING_USE[use]}`;
  return code;
}
