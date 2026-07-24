# Project: NYC Building Ages Map

An interactive map of NYC showing when each building/tax lot was constructed, built to practice Python + web service development. Not a duplicate of an existing service — this visualizes construction history block-by-block, not just a data lookup tool.

**Hosting**: static site on GitHub Pages. PLUTO data updates only a few times a year, so no live backend is needed — data is fetched and exported to static GeoJSON periodically, and the frontend loads those files directly.

## Data source

- **Dataset**: NYC PLUTO (Primary Land Use Tax Lot Output), maintained by NYC Dept. of City Planning
- **Endpoint**: `https://data.cityofnewyork.us/resource/64uk-42ks.json`
- **Current version**: 26v1, ~870,000 tax lots citywide, 70+ fields, no API key required for reasonable query volumes
- **Key fields**: `bbl` (unique lot ID), `yearbuilt`, `borough`, `latitude`/`longitude` (or `the_geom` for lot polygon), `numfloors`, `bldgarea`, `landuse`, `zonedist1`, `address`
- Socrata supports SQL-like filtering (`$where`, `$select`, `$limit`, `$offset`) — pull only what's needed instead of the full file

## Build plan (incremental — each stage should work standalone)

### Stage 1 — Get and shape the data
- Python script (`requests`) to pull PLUTO in batches
- Start with one borough (e.g. Manhattan) to keep it manageable before scaling citywide
- Clean with `pandas`: drop lots with missing/zero `yearbuilt` (vacant lots, city-owned land, data gaps)
- Bucket `yearbuilt` into decades

### Stage 2 — Export static GeoJSON
- From the cleaned PLUTO extract, export static GeoJSON files (split by borough or decade to keep individual file sizes reasonable)
- Re-run periodically (manually or on a schedule) to refresh data — no live server needed since PLUTO doesn't update often
- No FastAPI backend needed for the deployed site; GitHub Pages serves the GeoJSON as static files

### Stage 3 — Frontend map
- Leaflet.js + GeoJSON layer, loaded via `fetch()` directly from the static files
- Color-code lots by decade built (sequential color scale — dark red pre-1900 → bright yellow 2020s)
- Click a lot → popup with address, year built, floors, zoning
- Decade slider/filter to "rewind" the map

### Stretch goal
- Animate through decades (play button) to show the city's growth ring by ring
- If live/always-current data becomes desirable later, a small backend (FastAPI on a free tier like Render or Fly.io) could replace the static GeoJSON — not needed for the initial version

## Suggested repo structure

```
nyc-building-ages/
  data-prep/
    fetch_pluto.py     # data pull + cleaning script
    export_geojson.py  # exports static GeoJSON for the frontend
  docs/                # GitHub Pages serves from here
    index.html
    map.js             # Leaflet setup, color scale, click handlers
    style.css
    data/
      manhattan.geojson
      brooklyn.geojson
      ...
```

Note: GitHub Pages can serve from a `/docs` folder on the main branch (or a dedicated `gh-pages` branch) — no separate hosting needed for the static site itself.

## Preferences for this project

- Prefer simple, incremental solutions over over-engineered ones
- Plain-language explanations and step-by-step walkthroughs when introducing new concepts
- Practicing fresh Python skills — favor clarity over cleverness in code
