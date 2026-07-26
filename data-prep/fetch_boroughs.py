"""
Landing-page data — NYC borough outlines.

Downloads the five borough boundary shapes from NYC Open Data, simplifies
them (the raw file has fine coastline detail we don't need for a zoomed-out
overview map), and writes a small docs/data/boroughs.geojson.

The landing page (index.html) draws these five clickable shapes; clicking
one opens that borough's detail page.

Run it like:
    python fetch_boroughs.py
"""

import json
from pathlib import Path

import requests
from shapely.geometry import mapping, shape

# NYC Open Data "Borough Boundaries" (clipped to shoreline), exported as GeoJSON.
BOUNDARIES_URL = (
    "https://data.cityofnewyork.us/api/geospatial/gthc-hcne"
    "?method=export&format=GeoJSON"
)

OUT_PATH = Path(__file__).parent.parent / "docs" / "data" / "boroughs.geojson"

# How aggressively to simplify, in degrees. ~0.0003 deg is ~30 m — smooths the
# jagged coastline while keeping each borough clearly recognizable.
SIMPLIFY_TOLERANCE = 0.0003
COORD_PRECISION = 5

# Map the dataset's borough names to the file slugs our detail page uses,
# so the landing page can link straight to borough.html?borough=<slug>.
SLUGS = {
    "Manhattan": "manhattan",
    "Bronx": "bronx",
    "Brooklyn": "brooklyn",
    "Queens": "queens",
    "Staten Island": "staten_island",
}


def round_coords(geojson_geom, precision):
    """Recursively round every coordinate in a GeoJSON geometry dict."""
    def _round(obj):
        if isinstance(obj, (int, float)):
            return round(obj, precision)
        return [_round(x) for x in obj]

    geojson_geom["coordinates"] = _round(geojson_geom["coordinates"])
    return geojson_geom


def main():
    print("Downloading borough boundaries...")
    response = requests.get(BOUNDARIES_URL, timeout=60)
    response.raise_for_status()
    raw = response.json()

    features = []
    for feat in raw["features"]:
        name = feat["properties"]["boroname"]

        geom = shape(feat["geometry"])
        simplified = geom.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
        geom_dict = round_coords(mapping(simplified), COORD_PRECISION)

        features.append({
            "type": "Feature",
            "properties": {"name": name, "slug": SLUGS[name]},
            "geometry": geom_dict,
        })
        print(f"  {name}: simplified")

    collection = {"type": "FeatureCollection", "features": features}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(collection, f, separators=(",", ":"))

    size_kb = OUT_PATH.stat().st_size / 1000
    print(f"Saved {len(features)} boroughs -> {OUT_PATH} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
