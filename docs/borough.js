// Detail page: show one borough's lots as dots colored by decade, with a
// "rewind" slider that hides buildings newer than the chosen decade.

const SLUGS = {
  manhattan: "Manhattan",
  bronx: "Bronx",
  brooklyn: "Brooklyn",
  queens: "Queens",
  staten_island: "Staten Island",
};

const params = new URLSearchParams(window.location.search);
const slug = params.get("borough");
if (!SLUGS[slug]) {
  document.getElementById("borough-title").textContent = "Unknown borough";
  throw new Error("Unknown or missing borough: " + slug);
}
document.getElementById("borough-title").textContent = SLUGS[slug];
document.title = `NYC Building Ages — ${SLUGS[slug]}`;

// preferCanvas draws the dots on one <canvas> instead of a DOM node per dot,
// which is what lets us show hundreds of thousands.
const map = L.map("map", { preferCanvas: true });
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  // This page has no footer, so the credits ride along in the attribution.
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · Data: <a href="https://www.nyc.gov/content/planning/pages/resources?search=pluto#datasets">NYC PLUTO</a> (26v1) · Map icon by <a href="https://www.flaticon.com/free-icons/map" title="map icons">Magnific - Flaticon</a>',
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
    // Built on click, not up front — keeps setup fast.
    marker.bindPopup(() => popupHtml(props));

    (decadeGroups[props.decade] ||= []).push(marker);
    bounds.extend([lat, lon]);
  });

  map.fitBounds(bounds, { padding: [20, 20] });

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

  // Dragging the slider hands control back to the cumulative view.
  slider.addEventListener("input", () => setActiveBand(null));
  playBtn.addEventListener("click", togglePlay);
}

// An isolated band shows only its own period; otherwise everything up to the
// slider.
function isDecadeVisible(decade) {
  if (activeBand) return decade >= activeBand.min && decade <= activeBand.max;
  return decade <= Number(slider.value);
}

// Sync the map to the current filter state. We only add/remove the decades
// whose visibility actually changed, so this stays responsive even on Queens.
function refresh() {
  let visible = 0;

  // Newest -> oldest, so older decades are added last and draw *on top*. Where
  // dots overlap, that shows an area's older buildings rather than burying them.
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

function updateStatusText() {
  if (activeBand) {
    statusEl.innerHTML = `Showing only <strong>${activeBand.label}</strong>`;
  } else {
    statusEl.innerHTML = `Showing buildings built by <strong>${slider.value}</strong>s`;
  }
}

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

// --- Play button: step the slider forward through the decades. ---
let playTimer = null;

function togglePlay() {
  if (playTimer) {
    stopPlay();
    return;
  }
  // Play animates the cumulative timeline, so drop any isolated legend band.
  activeBand = null;
  updateLegendUI();
  // Pressing play at the end means "replay" — rewind first. Only ever happens
  // on an explicit press; playback stops at the newest decade, never loops.
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

  // Land exactly on the newest decade rather than overshooting it.
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

// --- Legend: a swatch per time-period band, plus "All periods". The clickable
//     list on desktop and the dropdown on narrow screens drive the same state. ---
const legendRows = []; // { band, row } for each period band
let allRow = null; // the "All periods" reset row
let legendSelect = null; // the mobile <select>

function buildLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = '<div class="legend-title">Period built</div>';

  // "All periods" clears the filter; its swatch previews the whole ramp.
  allRow = document.createElement("div");
  allRow.className = "legend-row";
  allRow.innerHTML = '<span class="swatch swatch-all"></span>All periods';
  allRow.addEventListener("click", () => {
    stopPlay();
    setActiveBand(null);
  });
  el.appendChild(allRow);

  LEGEND_BANDS.forEach((band) => {
    const row = document.createElement("div");
    row.className = "legend-row";
    row.innerHTML =
      `<span class="swatch" style="background:${colorForDecade(band.decade)}"></span>` +
      band.label;
    row.addEventListener("click", () => toggleBand(band));
    el.appendChild(row);
    legendRows.push({ band, row });
  });

  const hint = document.createElement("div");
  hint.className = "legend-hint";
  hint.textContent = "Click a period to isolate it";
  el.appendChild(hint);

  buildLegendSelect();
  updateLegendUI();
}

function buildLegendSelect() {
  legendSelect = document.getElementById("legend-select");
  legendSelect.innerHTML =
    '<option value="">All periods</option>' +
    LEGEND_BANDS.map((band, i) => `<option value="${i}">${band.label}</option>`).join("");
  legendSelect.addEventListener("change", () => {
    stopPlay();
    const value = legendSelect.value;
    setActiveBand(value === "" ? null : LEGEND_BANDS[Number(value)]);
  });
}

function toggleBand(band) {
  stopPlay(); // isolating isn't a cumulative animation
  setActiveBand(activeBand === band ? null : band);
}

// The single place that changes the filter and re-syncs every control.
function setActiveBand(band) {
  activeBand = band;
  updateLegendUI();
  updateStatusText();
  refresh();
}

// Keep both legend UIs in step with the current filter.
function updateLegendUI() {
  legendRows.forEach(({ band, row }) => {
    row.classList.toggle("active", band === activeBand);
  });
  if (allRow) allRow.classList.toggle("active", activeBand === null);
  if (legendSelect) {
    legendSelect.value = activeBand ? String(LEGEND_BANDS.indexOf(activeBand)) : "";
  }
}
