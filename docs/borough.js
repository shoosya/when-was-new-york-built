// Detail page: one borough's lots as dots colored by decade.
//
// Lots live in parallel typed arrays and a GridLayer paints them onto canvas
// tiles. One L.circleMarker per lot — the obvious alternative — costs ~870
// bytes of heap each, ~270 MB for Queens, enough to get the tab killed on a
// phone. These arrays come to about 9 bytes per lot.

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

const map = L.map("map");
// Leaflet's own "Leaflet" prefix is optional; OSM and CARTO's credits are not.
map.attributionControl.setPrefix(false);
L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  // No footer on this page, so credits ride along in the attribution chip.
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> · Data: <a href="https://www.nyc.gov/content/planning/pages/resources?search=pluto#datasets">NYC PLUTO</a> (26v1)',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

// --- The lots, as parallel arrays. Index i is one lot across all of them. ---
const lots = {
  n: 0,
  wx: null, // position as normalized Web Mercator, 0..1 across the world
  wy: null,
  decade: null,
  year: null,
  floorsX10: null, // 65535 = unknown
  zoneIdx: null, // 65535 = unknown
  addrOff: null, // start offset of each address in addrBlob
  addrBlob: null,
  zones: [],
  countByDecade: new Map(),
};

const slider = document.getElementById("slider");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const playBtn = document.getElementById("play");
const summaryEl = document.getElementById("map-summary");

// The map has two ways to filter by time, and they take turns:
//   - the slider shows everything built *up to* a decade (cumulative "rewind")
//   - clicking a legend band isolates *only* that period
// `activeBand` holds the isolated band, or null when the slider is in charge.
let activeBand = null;

fetch(`data/${slug}.bin`)
  .then((response) => response.arrayBuffer())
  .then((buffer) => build(buffer))
  .catch((err) => {
    console.error(err);
    alert("Could not load building data.");
  });

// Layout is documented in data-prep/export_points.py. Blocks are copied out
// rather than viewed in place, so they don't have to be aligned.
function build(buffer) {
  const head = new DataView(buffer);
  const magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  if (magic !== "NYCP") throw new Error("Not a points file: " + magic);

  const n = head.getUint32(8, true);
  const zoneLen = head.getUint32(12, true);
  const addrLen = head.getUint32(16, true);

  let off = 24;
  const take = (Type, count) => {
    const bytes = count * Type.BYTES_PER_ELEMENT;
    const arr = new Type(buffer.slice(off, off + bytes));
    off += bytes;
    return arr;
  };

  const lonE6 = take(Int32Array, n);
  const latE6 = take(Int32Array, n);
  lots.year = take(Uint16Array, n);
  lots.floorsX10 = take(Uint16Array, n);
  lots.zoneIdx = take(Uint16Array, n);
  lots.addrOff = take(Uint32Array, n);
  off += 4; // the file stores n+1 offsets; the last one is just the total
  lots.zones = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, off, zoneLen)),
  );
  off += zoneLen;
  lots.addrBlob = new Uint8Array(buffer.slice(off, off + addrLen));

  // Project once: a sin+log per point per tile would dominate the draw loop.
  lots.n = n;
  lots.wx = new Float64Array(n);
  lots.wy = new Float64Array(n);
  lots.decade = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    lots.wx[i] = lonToWX(lonE6[i] / 1e6);
    lots.wy[i] = latToWY(latE6[i] / 1e6);
    const d = Math.floor(lots.year[i] / 10) * 10;
    lots.decade[i] = d;
    lots.countByDecade.set(d, (lots.countByDecade.get(d) || 0) + 1);
  }

  buildIndex();

  const decades = [...lots.countByDecade.keys()].sort((a, b) => a - b);
  slider.min = decades[0];
  slider.max = decades[decades.length - 1];
  slider.value = slider.max;

  map.fitBounds(dataBounds(), { padding: [20, 20] });
  pointsLayer.addTo(map);

  buildLegend();
  updateStatusText();
  refresh();

  // Dragging the slider hands control back to the cumulative view.
  slider.addEventListener("input", () => setActiveBand(null));
  playBtn.addEventListener("click", togglePlay);
}

function lonToWX(lon) {
  return (lon + 180) / 360;
}
function latToWY(lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}
function wxToLon(wx) {
  return wx * 360 - 180;
}
function wyToLat(wy) {
  return (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - 2 * wy)));
}

function dataBounds() {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  for (let i = 0; i < lots.n; i++) {
    if (lots.wx[i] < x0) x0 = lots.wx[i];
    if (lots.wx[i] > x1) x1 = lots.wx[i];
    if (lots.wy[i] < y0) y0 = lots.wy[i];
    if (lots.wy[i] > y1) y1 = lots.wy[i];
  }
  return L.latLngBounds([wyToLat(y1), wxToLon(x0)], [wyToLat(y0), wxToLon(x1)]);
}

// Flat grid so drawing a tile or testing a tap visits nearby lots, not all
// 312k. `order` lists lot indexes grouped by cell; `cellStart` where each
// cell's group begins.
const GRID = 64;
const index = { x0: 0, y0: 0, spanX: 1, spanY: 1, cellStart: null, order: null };

function buildIndex() {
  const b = dataBounds();
  index.x0 = lonToWX(b.getWest());
  index.y0 = latToWY(b.getNorth());
  index.spanX = lonToWX(b.getEast()) - index.x0 || 1e-9;
  index.spanY = latToWY(b.getSouth()) - index.y0 || 1e-9;

  const counts = new Uint32Array(GRID * GRID + 1);
  const cellOf = new Uint32Array(lots.n);
  for (let i = 0; i < lots.n; i++) {
    const c = cellIndex(lots.wx[i], lots.wy[i]);
    cellOf[i] = c;
    counts[c + 1]++;
  }
  for (let c = 0; c < GRID * GRID; c++) counts[c + 1] += counts[c];

  const order = new Uint32Array(lots.n);
  const cursor = counts.slice(0, GRID * GRID);
  for (let i = 0; i < lots.n; i++) order[cursor[cellOf[i]]++] = i;

  index.cellStart = counts;
  index.order = order;
}

function clampCell(v) {
  return v < 0 ? 0 : v > GRID - 1 ? GRID - 1 : v;
}
function cellX(wx) {
  return clampCell(Math.floor(((wx - index.x0) / index.spanX) * GRID));
}
function cellY(wy) {
  return clampCell(Math.floor(((wy - index.y0) / index.spanY) * GRID));
}
function cellIndex(wx, wy) {
  return cellY(wy) * GRID + cellX(wx);
}

function forEachInBox(wx0, wy0, wx1, wy1, visit) {
  const cx0 = cellX(wx0),
    cx1 = cellX(wx1),
    cy0 = cellY(wy0),
    cy1 = cellY(wy1);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * GRID + cx;
      const end = index.cellStart[c + 1];
      for (let k = index.cellStart[c]; k < end; k++) visit(index.order[k]);
    }
  }
}

// One canvas per map tile; Leaflet handles positioning, caching and panning,
// so a filter change is just redraw().

// Smaller dots when zoomed out: a fixed 4px radius draws hundreds of thousands
// of overlapping dots into a few hundred pixels — slow, and an unreadable blob.
function radiusForZoom(z) {
  if (z >= 16) return 4;
  if (z >= 14) return 3;
  if (z >= 12) return 2;
  return 1.5;
}

const PointsLayer = L.GridLayer.extend({
  createTile(coords) {
    const size = this.getTileSize();
    const canvas = L.DomUtil.create("canvas");
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.x * dpr;
    canvas.height = size.y * dpr;
    canvas.style.width = size.x + "px";
    canvas.style.height = size.y + "px";
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    if (lots.n) drawTile(ctx, coords, size.x);
    return canvas;
  },
});
// zIndex 2 puts the dots above the basemap, which Leaflet gives zIndex 1.
const pointsLayer = new PointsLayer({ zIndex: 2, maxZoom: 19 });

function drawTile(ctx, coords, tileSize) {
  const scale = Math.pow(2, coords.z);
  const r = radiusForZoom(coords.z);
  // Reach past the tile edge, or dots straddling the seam look clipped.
  const pad = (r + 1) / (tileSize * scale);

  const wx0 = coords.x / scale - pad;
  const wx1 = (coords.x + 1) / scale + pad;
  const wy0 = coords.y / scale - pad;
  const wy1 = (coords.y + 1) / scale + pad;

  // Group by decade so fillStyle is set once per color rather than per dot.
  const byDecade = new Map();
  forEachInBox(wx0, wy0, wx1, wy1, (i) => {
    const wx = lots.wx[i],
      wy = lots.wy[i];
    if (wx < wx0 || wx > wx1 || wy < wy0 || wy > wy1) return;
    if (!isDecadeVisible(lots.decade[i])) return;
    let pts = byDecade.get(lots.decade[i]);
    if (!pts) byDecade.set(lots.decade[i], (pts = []));
    pts.push((wx * scale - coords.x) * tileSize, (wy * scale - coords.y) * tileSize);
  });

  // Oldest last, so older buildings draw on top where dots overlap.
  const decades = [...byDecade.keys()].sort((a, b) => b - a);
  ctx.globalAlpha = 0.8;
  for (const d of decades) {
    const pts = byDecade.get(d);
    ctx.fillStyle = colorForDecade(d);
    ctx.beginPath();
    for (let k = 0; k < pts.length; k += 2) {
      ctx.moveTo(pts[k] + r, pts[k + 1]);
      ctx.arc(pts[k], pts[k + 1], r, 0, 6.283185307179586);
    }
    ctx.fill();
  }
}

function isDecadeVisible(decade) {
  if (activeBand) return decade >= activeBand.min && decade <= activeBand.max;
  return decade <= Number(slider.value);
}

// The count comes from per-decade totals worked out at load, never a rescan.
function refresh() {
  let visible = 0;
  for (const [decade, count] of lots.countByDecade) {
    if (isDecadeVisible(decade)) visible += count;
  }
  countEl.textContent = `${visible.toLocaleString()} buildings`;
  announce(visible);
  pointsLayer.redraw();
}

function announce(visible) {
  const what = activeBand
    ? `built ${activeBand.label}`
    : `built up to the ${slider.value}s`;
  summaryEl.textContent =
    `${visible.toLocaleString()} of ${lots.n.toLocaleString()} ` +
    `${SLUGS[slug]} buildings shown, ${what}.`;
  slider.setAttribute("aria-valuetext", `${slider.value}s`);
}

map.on("click", (e) => {
  if (!lots.n) return;
  const scale = Math.pow(2, map.getZoom());
  const tol = 12 / (256 * scale); // ~12 screen pixels, in normalized units
  const cwx = lonToWX(e.latlng.lng);
  const cwy = latToWY(e.latlng.lat);

  let best = -1;
  let bestDist = tol * tol;
  forEachInBox(cwx - tol, cwy - tol, cwx + tol, cwy + tol, (i) => {
    if (!isDecadeVisible(lots.decade[i])) return;
    const dx = lots.wx[i] - cwx;
    const dy = lots.wy[i] - cwy;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });

  if (best >= 0) {
    const at = [wyToLat(lots.wy[best]), wxToLon(lots.wx[best])];
    highlight(at);
    L.popup().setLatLng(at).setContent(popupHtml(best)).openOn(map);
  }
});

// A single vector marker, not a change to the tile drawing: repainting every
// tile to move one highlight isn't worth it.
let selectedRing = null;

function highlight(latlng) {
  if (selectedRing) map.removeLayer(selectedRing);
  selectedRing = L.circleMarker(latlng, {
    radius: 9,
    // Darker than --accent: plain coral is 2.91:1 on the basemap, under 3:1.
    color: "#ea4550",
    weight: 3,
    opacity: 1,
    fill: false,
    interactive: false, // never swallow the next click meant for the map
  }).addTo(map);
}

map.on("popupclose", () => {
  if (selectedRing) {
    map.removeLayer(selectedRing);
    selectedRing = null;
  }
});

function addressOf(i) {
  const start = lots.addrOff[i];
  const end = i + 1 < lots.n ? lots.addrOff[i + 1] : lots.addrBlob.length;
  return new TextDecoder().decode(lots.addrBlob.subarray(start, end));
}

function popupHtml(i) {
  const addr = addressOf(i) || "Address unknown";
  const tenths = lots.floorsX10[i];
  const floors =
    tenths !== 65535 && tenths > 0
      ? `${tenths / 10} floor${tenths === 10 ? "" : "s"}`
      : "floors n/a";
  const zoning = zoningLabel(
    lots.zoneIdx[i] === 65535 ? null : lots.zones[lots.zoneIdx[i]],
  );
  return (
    `<strong>${addr}</strong>` +
    `<br>Built ${lots.year[i]} · ${floors}` +
    `<br><span class="popup-label">Zoning:</span> ${zoning}`
  );
}

function updateStatusText() {
  if (activeBand) {
    statusEl.innerHTML = `Showing only <strong>${activeBand.label}</strong>`;
  } else {
    statusEl.innerHTML = `Showing buildings built by <strong>${slider.value}</strong>s`;
  }
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
  // Pressing play at the end means "replay" — rewind first. Never loops.
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

// The clickable list on desktop and the dropdown on mobile drive one state.
const legendRows = []; // { band, row } for each period band
let allRow = null; // the "All periods" reset row
let legendSelect = null; // the mobile <select>

function buildLegend() {
  const el = document.getElementById("legend");
  el.innerHTML = '<div class="legend-title">Period built</div>';

  // <button>, not a styled div: tab order, Enter/Space, and aria-pressed state.
  const makeRow = (inner, onPress) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "legend-row";
    row.setAttribute("aria-pressed", "false");
    row.innerHTML = inner;
    row.addEventListener("click", onPress);
    el.appendChild(row);
    return row;
  };

  // "All periods" clears the filter; its swatch previews the whole ramp.
  allRow = makeRow('<span class="swatch swatch-all"></span>All periods', () => {
    stopPlay();
    setActiveBand(null);
  });

  LEGEND_BANDS.forEach((band) => {
    const row = makeRow(
      `<span class="swatch" style="background:${colorForDecade(band.decade)}"></span>` +
        band.label,
      () => toggleBand(band),
    );
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

function updateLegendUI() {
  const mark = (row, on) => {
    row.classList.toggle("active", on);
    row.setAttribute("aria-pressed", String(on));
  };
  legendRows.forEach(({ band, row }) => mark(row, band === activeBand));
  if (allRow) mark(allRow, activeBand === null);
  if (legendSelect) {
    legendSelect.value = activeBand ? String(LEGEND_BANDS.indexOf(activeBand)) : "";
  }
}
