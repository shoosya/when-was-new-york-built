"""
Stage 2 — Export static GeoJSON.

Reads the cleaned CSVs made by fetch_pluto.py and writes one GeoJSON file
per borough into docs/data/. The frontend map (Stage 3) loads these files
directly with fetch() — no server needed.

Run it like:
    python export_geojson.py            # export every borough CSV found
    python export_geojson.py --borough manhattan   # just one

GeoJSON reminder: it's plain JSON describing map shapes. We build a
"FeatureCollection" — a list of "features", where each feature is one tax
lot: a Point at its longitude/latitude plus a bag of "properties" (address,
year, etc.) that the map can show in a popup.
"""

import argparse
import json
from pathlib import Path

import pandas as pd

# Where Stage 1 put the cleaned CSVs, and where the map expects its data.
IN_DIR = Path(__file__).parent / "output"
OUT_DIR = Path(__file__).parent.parent / "docs" / "data"

# Rounding lon/lat to 5 decimals is ~1 meter of precision — far more than
# enough to place a building, and it shrinks the files noticeably versus the
# 12+ digits the API hands back.
COORD_PRECISION = 5

# Only these columns ride along as feature properties. Keeping the list short
# keeps the files small; these are what the Stage 3 popup / color scale need.
PROPERTIES = ["address", "yearbuilt", "numfloors", "zonedist1", "decade"]


def row_to_feature(row):
    """Turn one DataFrame row into a single GeoJSON Point feature."""
    # GeoJSON coordinate order is [longitude, latitude] — easy to flip by
    # accident, so worth calling out.
    lon = round(float(row["longitude"]), COORD_PRECISION)
    lat = round(float(row["latitude"]), COORD_PRECISION)

    # Build the properties dict, converting numpy/pandas numbers to plain
    # Python ints so json can serialize them. Missing values become None.
    props = {}
    for col in PROPERTIES:
        value = row[col]
        if pd.isna(value):
            props[col] = None
        elif col in ("yearbuilt", "decade"):
            props[col] = int(value)
        elif col == "numfloors":
            props[col] = float(value)  # floors can be fractional (e.g. 2.5)
        else:
            props[col] = value

    return {
        "type": "Feature",
        # bbl is a whole-number ID; pandas may load it as a float (1015590019.0),
        # so cast to int before stringifying to drop the trailing ".0".
        "id": str(int(row["bbl"])),  # the unique tax-lot ID
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
        "properties": props,
    }


def export_csv(csv_path):
    """Read one borough CSV and write the matching .geojson file."""
    name = csv_path.stem  # e.g. "manhattan"
    df = pd.read_csv(csv_path)

    features = [row_to_feature(row) for _, row in df.iterrows()]
    collection = {"type": "FeatureCollection", "features": features}

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{name}.geojson"
    with open(out_path, "w") as f:
        # No indentation / spaces after separators = smallest file. These
        # are machine-read, not hand-edited, so compactness wins.
        json.dump(collection, f, separators=(",", ":"))

    size_mb = out_path.stat().st_size / 1_000_000
    print(f"  {name}: {len(features):,} features -> {out_path.name} ({size_mb:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(description="Export cleaned CSVs to GeoJSON.")
    parser.add_argument(
        "--borough",
        help="Base filename to export (e.g. 'manhattan'). Omit to export all.",
    )
    args = parser.parse_args()

    if args.borough:
        csv_paths = [IN_DIR / f"{args.borough}.csv"]
    else:
        csv_paths = sorted(IN_DIR.glob("*.csv"))

    if not csv_paths:
        print(f"No CSVs found in {IN_DIR}. Run fetch_pluto.py first.")
        return

    print(f"Exporting {len(csv_paths)} file(s) to {OUT_DIR}...")
    for csv_path in csv_paths:
        if not csv_path.exists():
            print(f"  skipping {csv_path.name}: not found")
            continue
        export_csv(csv_path)
    print("Done.")


if __name__ == "__main__":
    main()
