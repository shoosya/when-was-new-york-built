# When Was New York Built?

An interactive map of New York City showing **when each building was constructed**.
Pick a borough, then explore its ~40k–310k tax lots colored by the decade they went
up — with a "rewind" slider to watch the city grow and a clickable legend to isolate
any time period (slider only available in desktop view).

Built with Python (data prep) + Leaflet (map). It's a static site: the PLUTO data is
fetched and exported to GeoJSON periodically, and the browser loads those files
directly, so there's no backend to run.

## How it works

1. **`data-prep/fetch_pluto.py`** pulls one borough at a time from NYC's PLUTO open
   dataset, cleans it with pandas (drops lots with no year/coordinates, applies a
   sanity floor of 1625), buckets each lot into a decade, and saves a CSV.
2. **`data-prep/export_points.py`** turns those CSVs into the compact binary files
   the map actually loads (`docs/data/<borough>.bin`) — parallel arrays of
   fixed-width numbers, about 83% smaller than the same lots as GeoJSON. The
   format is documented at the top of that script.
3. **`data-prep/export_geojson.py`** writes the same lots as GeoJSON
   (`docs/data/<borough>.geojson`). The map no longer reads these; they're kept as
   a portable, human-readable copy of the data.
4. **`data-prep/fetch_boroughs.py`** downloads and simplifies the five borough
   outlines for the landing-page map (`docs/data/boroughs.geojson`).
5. **`docs/`** is the static site (served by GitHub Pages):
   - `index.html` — landing map; click a borough to open its page.
   - `borough.html` — one borough's lots, colored by decade, with the slider,
     play button, click-for-details popups, and the interactive legend.

## Project layout

```
when-was-new-york-built/
  data-prep/
    fetch_pluto.py       # pull + clean PLUTO -> data-prep/output/<borough>.csv
    export_points.py     # CSV -> docs/data/<borough>.bin (what the map loads)
    export_geojson.py    # CSV -> docs/data/<borough>.geojson (portable copy)
    fetch_boroughs.py    # borough outlines -> docs/data/boroughs.geojson
    output/              # intermediate CSVs (git-ignored, regenerable)
  docs/                  # the static site (GitHub Pages serves from here)
    index.html
    borough.html
    overview.js          # landing-map logic
    borough.js           # borough-map logic
    colors.js            # shared decade color scale + legend bands
    zoning.js            # plain-language labels for zoning codes
    style.css
    favicon.svg
    data/                # exported .bin + .geojson (committed — the site needs it)
  requirements.txt
```

## Setup

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Run the site locally

The site is just static files. Serve the `docs/` folder and open it in a browser:

```bash
.venv/bin/python -m http.server 8765 --directory docs
# then visit http://localhost:8765/
```

## Refresh the data

PLUTO only updates a few times a year, so this is occasional. One command
pulls + cleans every borough and re-exports the GeoJSON:

```bash
.venv/bin/python data-prep/refresh.py
# add --outlines to also refresh the borough outlines (rarely needed)
```

That's just a wrapper around the individual scripts, which you can still run
one at a time if you only need one borough:

```bash
.venv/bin/python data-prep/fetch_pluto.py --borough MN   # pull + clean one borough
.venv/bin/python data-prep/export_geojson.py             # CSV -> GeoJSON
```

## Deploy to GitHub Pages

1. Push this repository to GitHub.
2. In the repo's **Settings → Pages**, set the source to the **`main` branch, `/docs`
   folder**.
3. The site goes live at `https://<username>.github.io/when-was-new-york-built/`.

> Note: the Brooklyn and Queens GeoJSON files are ~55–66 MB. GitHub accepts files up
> to 100 MB but warns above 50 MB. If that becomes a problem, the exporter could be
> extended to split those boroughs by decade into smaller files.

## Data source

NYC PLUTO (Primary Land Use Tax Lot Output), NYC Dept. of City Planning —
<https://www.nyc.gov/content/planning/pages/resources?search=pluto#datasets>

## Credits

Favicon: <a href="https://www.flaticon.com/free-icons/map" title="map icons">Map
icons created by Magnific - Flaticon</a>.
