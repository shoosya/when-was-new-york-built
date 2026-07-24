// Shared decade color scale, used by both the legend and the map dots.
//
// It's a *sequential* ramp: one smooth path from dark red (oldest buildings)
// to bright yellow (newest). Lightness climbs steadily toward the present, so
// "older = darker/redder, newer = lighter/yellower" reads at a glance — even
// for most colorblind viewers, since they can still tell dark from light.

// Anchor colors, oldest -> newest, as [position 0..1, [r, g, b]].
// We linearly blend between neighboring anchors to get every decade's color.
const COLOR_STOPS = [
  [0.0, [128, 0, 38]],   // dark red   (oldest)
  [0.25, [215, 25, 28]], // red
  [0.5, [240, 124, 30]], // orange
  [0.75, [253, 183, 49]],// amber
  [1.0, [255, 229, 0]],  // bright yellow (newest)
];

// Anchor the ramp to this range. Almost every NYC lot is 1880 or later, so
// starting here spreads the colors across the years that actually have data
// instead of squashing them all into the yellow end. Anything older just
// gets the darkest red.
const DECADE_MIN = 1880;
const DECADE_MAX = 2020;

function colorForDecade(decade) {
  // Position this decade on the 0..1 ramp, clamped to the ends.
  let t = (decade - DECADE_MIN) / (DECADE_MAX - DECADE_MIN);
  t = Math.max(0, Math.min(1, t));

  // Find the two anchors t sits between, then blend them by how far along it is.
  for (let i = 1; i < COLOR_STOPS.length; i++) {
    const [t0, c0] = COLOR_STOPS[i - 1];
    const [t1, c1] = COLOR_STOPS[i];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const r = Math.round(c0[0] + f * (c1[0] - c0[0]));
      const g = Math.round(c0[1] + f * (c1[1] - c0[1]));
      const b = Math.round(c0[2] + f * (c1[2] - c0[2]));
      return `rgb(${r},${g},${b})`;
    }
  }
  return "rgb(255,229,0)";
}

// The legend's time-period bands. Each is a clickable filter that isolates one
// period, so together they cover every decade with no gaps:
//   min / max  — the decade range this band matches (inclusive)
//   decade     — the decade used to pick the band's swatch color
const LEGEND_BANDS = [
  { label: "Before 1900", min: 0, max: 1890, decade: 1880 },
  { label: "1900–1919", min: 1900, max: 1910, decade: 1900 },
  { label: "1920–1939", min: 1920, max: 1930, decade: 1920 },
  { label: "1940–1959", min: 1940, max: 1950, decade: 1940 },
  { label: "1960–1979", min: 1960, max: 1970, decade: 1960 },
  { label: "1980–1999", min: 1980, max: 1990, decade: 1980 },
  { label: "2000–2019", min: 2000, max: 2010, decade: 2000 },
  { label: "2020s", min: 2020, max: 9999, decade: 2020 },
];
