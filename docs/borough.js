// Detail page: show one borough's lots as dots colored by decade, with a
// "rewind" slider that hides buildings newer than the chosen decade.

const SLUGS = {
  manhattan: "Manhattan",
  bronx: "Bronx",
  brooklyn: "Brooklyn",
  queens: "Queens",
  staten_island: "Staten Island",
};

// --- Which borough are we showing? Read it from the URL (?borough=queens). ---
const params = new URLSearchParams(window.location.search);
const slug = params.get("borough");
if (!SLUGS[slug]) {
  document.getElementById("borough-title").textContent = "Unknown borough";
  throw new Error("Unknown or missing borough: " + slug);
}
document.getElementById("borough-title").textContent = SLUGS[slug];
document.title = `NYC Building Ages — ${SLUGS[slug]}`;

// --- The map. preferCanvas draws the dots on one <canvas> instead of making
//     a DOM node per dot, which is what lets us show hundreds of thousands. ---
const map = L.map("map", { preferCanvas: true });
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

// Markers are grouped by decade so the slider can show/hide a whole decade at
// once, only touching the dots that actually change.
const decadeGroups = {}; // { 1920: [marker, marker, ...], ... }
const shownLayer = L.layerGroup().addTo(map);
const shownDecades = new Set();

const slider = document.getElementById("slider");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const playBtn = document.getElementById("play");

// The map has two ways to filter by time, and they take turns:
//   - the slider shows everything built *up to* a decade (cumulative "rewind")
//   - clicking a legend band isolates *only* that period
// `activeBand` holds the isolated band, or null when the slider is in charge.
let activeBand = null;

// --- Load this borough's data and build the map. ---
fetch(`data/${slug}.geojson`)
  .then((response) => response.json())
  .then((geojson) => build(geojson))
  .catch((err) => {
    console.error(err);
    alert("Could not load building data.");
  });

function build(geojson) {
  const bounds = L.latLngBounds([]);

  geojson.features.forEach((feature) => {
    // GeoJSON stores coordinates as [lon, lat]; Leaflet wants [lat, lon].
    const [lon, lat] = feature.geometry.coordinates;
    const props = feature.properties;

    const marker = L.circleMarker([lat, lon], {
      radius: 4, // the visible dot
      fillColor: colorForDecade(props.decade),
      fillOpacity: 0.8,
      // A wide but fully transparent outline. It's never seen (opacity 0), but
      // Leaflet counts half the outline's weight toward the clickable area — so
      // this grows the click target to ~11px without enlarging the dot itself.
      stroke: true,
      color: "#000",
      opacity: 0,
      weight: 14,
    });
    // Build the popup only when it's actually clicked (keeps setup fast).
    marker.bindPopup(() => popupHtml(props));

    (decadeGroups[props.decade] ||= []).push(marker);
    bounds.extend([lat, lon]);
  });

  map.fitBounds(bounds, { padding: [20, 20] });

  // Configure the slider from the decades we actually have data for.
  const decades = Object.keys(decadeGroups)
    .map(Number)
    .sort((a, b) => a - b);
  const minDecade = decades[0];
  const maxDecade = decades[decades.length - 1];
  slider.min = minDecade;
  slider.max = maxDecade;
  slider.value = maxDecade;

  buildLegend();
  updateStatusText();
  refresh(); // start with everything visible

  // Dragging the slider hands control back to the cumulative view, clearing
  // any isolated legend band.
  slider.addEventListener("input", () => {
    activeBand = null;
    updateLegendHighlight();
    updateStatusText();
    refresh();
  });
  playBtn.addEventListener("click", togglePlay);
}

// Decide whether a decade's dots should be visible right now: only its own
// period when a legend band is isolated, otherwise everything up to the slider.
function isDecadeVisible(decade) {
  if (activeBand) return decade >= activeBand.min && decade <= activeBand.max;
  return decade <= Number(slider.value);
}

// Sync the map to the current filter state. We only add/remove the decades
// whose visibility actually changed, so this stays responsive even on Queens.
function refresh() {
  let visible = 0;

  // Iterate newest -> oldest so older decades are added last and therefore
  // drawn *on top*. Where dots overlap (dense areas at low zoom), that lets a
  // neighborhood's older buildings show through instead of being buried under
  // newer ones — a more honest picture of when an area was built up.
  Object.keys(decadeGroups)
    .map(Number)
    .sort((a, b) => b - a)
    .forEach((decade) => {
      const markers = decadeGroups[decade];
      const shouldShow = isDecadeVisible(decade);
      if (shouldShow) visible += markers.length;

      if (shouldShow && !shownDecades.has(decade)) {
        markers.forEach((m) => shownLayer.addLayer(m));
        shownDecades.add(decade);
      } else if (!shouldShow && shownDecades.has(decade)) {
        markers.forEach((m) => shownLayer.removeLayer(m));
        shownDecades.delete(decade);
      }
    });

  countEl.textContent = `${visible.toLocaleString()} buildings`;
}

// The line next to the slider, describing whichever filter is active.
function updateStatusText() {
  if (activeBand) {
    statusEl.innerHTML = `Showing only <strong>${activeBand.label}</strong>`;
  } else {
    statusEl.innerHTML = `Showing buildings built by <strong>${slider.value}</strong>s`;
  }
}

// The popup shown when a dot is clicked.
function popupHtml(p) {
  const addr = p.address || "Address unknown";
  const floors =
    p.numfloors > 0
      ? `${p.numfloors} floor${p.numfloors === 1 ? "" : "s"}`
      : "floors n/a";
  const zoning = zoningLabel(p.zonedist1);
  return (
    `<strong>${addr}</strong>` +
    `<br>Built ${p.yearbuilt} · ${floors}` +
    `<br><span class="popup-label">Zoning:</span> ${zoning}`
  );
}

// --- Play button: step the slider forward through the decades automatically. ---
let playTimer = null;

function togglePlay() {
  // Pressing the button while playing pauses it.
  if (playTimer) {
    stopPlay();
    return;
  }
  // Play animates the cumulative timeline, so drop any isolated legend band.
  activeBand = null;
  updateLegendHighlight();
  // Starting a run from the end means "replay": rewind to the earliest decade
  // first. (This only happens on an explicit press — playback never restarts
  // itself; when it reaches the newest decade it simply stops.)
  if (Number(slider.value) >= Number(slider.max)) {
    slider.value = slider.min;
  }
  updateStatusText();
  refresh();
  playBtn.textContent = "❚❚";
  playTimer = setInterval(step, 700);
}

function step() {
  const next = Number(slider.value) + 10;
  const max = Number(slider.max);

  // Reached (or passed) the newest decade: land exactly on it and stop.
  // No looping back to the start.
  if (next >= max) {
    slider.value = max;
  } else {
    slider.value = next;
  }
  updateStatusText();
  refresh();
  if (Number(slider.value) >= max) stopPlay();
}

function stopPlay() {
  clearInterval(playTimer);
  playTimer = null;
  playBtn.textContent = "▶";
}

// --- Legend: a clickable swatch per time-period band. ---
// Keep each band's row element so we can highlight the active one.
const legendRows = [];

function buildLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = '<div class="legend-title">Period built</div>';

  LEGEND_BANDS.forEach((band) => {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      `<span class="swatch" style="background:${colorForDecade(band.decade)}"></span>` +
      band.label;
    row.addEventListener("click", () => selectBand(band));
    el.appendChild(row);
    legendRows.push({ band, row });
  });

  const hint = document.createElement("div");
  hint.className = "legend-hint";
  hint.textContent = "Click a period to isolate it";
  el.appendChild(hint);
}

// Isolate a period — or clear it if that period is already isolated.
function selectBand(band) {
  stopPlay(); // isolating isn't a cumulative animation
  activeBand = activeBand === band ? null : band;
  updateLegendHighlight();
  updateStatusText();
  refresh();
}

// Mark whichever band (if any) is currently isolated.
function updateLegendHighlight() {
  legendRows.forEach(({ band, row }) => {
    row.classList.toggle("active", band === activeBand);
  });
}
