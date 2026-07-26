"""
Stage 2b — Export the map's point data as a compact binary file.

Why not just GeoJSON? The map draws every lot as a dot, and GeoJSON spends
~150 bytes per lot on structure ("type":"Feature", "geometry", "Point", the
property names) before it gets to the ~55 bytes that are actually data. On a
phone that costs twice: a big JSON.parse, and then a large object graph sitting
in memory. Queens is 65 MB of GeoJSON and roughly 180 MB of parsed objects.

The same lots as parallel arrays of fixed-width numbers come to ~12 MB, and the
browser can hand them straight to typed arrays with no per-lot parsing at all.

Layout (little-endian). Every block is written back to back, no padding — the
reader copies each one out by offset, so alignment never matters:

    offset  type          count   field
    0       char[4]               "NYCP" magic
    4       uint32                format version
    8       uint32                n (number of lots)
    12      uint32                length of the zoning table, in bytes
    16      uint32                length of the address blob, in bytes
    20      uint32                reserved (0)
    24      int32         n       longitude x 1e6
            int32         n       latitude  x 1e6
            uint16        n       year built (0 = unknown)
            uint16        n       floors x 10 (65535 = unknown)
            uint16        n       index into the zoning table (65535 = unknown)
            uint32        n + 1   address start offsets, last entry = total
            utf-8         -       zoning table, a JSON array of strings
            utf-8         -       every address, concatenated

Coordinates are integers scaled by a million (~0.1 m) rather than floats,
because a float32 only has about 7 digits of precision — just barely enough for
a longitude like -73.950123, and the rounding would be visible as jitter.

Run it like:
    python export_points.py            # every borough CSV found
    python export_points.py --borough manhattan
"""

import argparse
import json
import struct
from pathlib import Path

import numpy as np
import pandas as pd

IN_DIR = Path(__file__).parent / "output"
OUT_DIR = Path(__file__).parent.parent / "docs" / "data"

MAGIC = b"NYCP"
VERSION = 1
UNKNOWN_U16 = 65535
COORD_SCALE = 1_000_000


def export_csv(csv_path):
    """Read one borough CSV and write the matching .bin file."""
    name = csv_path.stem
    df = pd.read_csv(csv_path)
    n = len(df)

    lon = np.round(df["longitude"].to_numpy(float) * COORD_SCALE).astype("<i4")
    lat = np.round(df["latitude"].to_numpy(float) * COORD_SCALE).astype("<i4")

    year = df["yearbuilt"].fillna(0).to_numpy(float).astype("<u2")

    # Floors can be fractional (2.5), so store tenths. Missing stays distinct
    # from a real 0 floors, which PLUTO does record for vacant lots.
    floors_raw = df["numfloors"].to_numpy(float)
    floors = np.where(
        np.isnan(floors_raw), UNKNOWN_U16, np.round(floors_raw * 10)
    ).astype("<u2")

    # One shared table of zoning codes; each lot stores an index into it. There
    # are only a couple hundred distinct codes across ~800k lots.
    zones = sorted({z for z in df["zonedist1"].dropna().unique()})
    zone_index = {z: i for i, z in enumerate(zones)}
    zone_idx = (
        df["zonedist1"].map(zone_index).fillna(UNKNOWN_U16).to_numpy(float).astype("<u2")
    )

    # Addresses go into one long string plus a list of start offsets, so the
    # browser holds a single buffer instead of n separate string objects and
    # decodes one only when a popup opens.
    addresses = df["address"].fillna("").astype(str).tolist()
    encoded = [a.encode("utf-8") for a in addresses]
    offsets = np.zeros(n + 1, dtype="<u4")
    np.cumsum([len(a) for a in encoded], out=offsets[1:])
    addr_blob = b"".join(encoded)

    zone_json = json.dumps(zones, separators=(",", ":")).encode("utf-8")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{name}.bin"
    with open(out_path, "wb") as f:
        f.write(MAGIC)
        f.write(struct.pack("<IIIII", VERSION, n, len(zone_json), len(addr_blob), 0))
        for block in (lon, lat, year, floors, zone_idx, offsets):
            f.write(block.tobytes())
        f.write(zone_json)
        f.write(addr_blob)

    size_mb = out_path.stat().st_size / 1_000_000
    geojson = OUT_DIR / f"{name}.geojson"
    if geojson.exists():
        was = geojson.stat().st_size / 1_000_000
        print(
            f"  {name}: {n:,} lots -> {out_path.name} "
            f"({size_mb:.1f} MB, was {was:.1f} MB as GeoJSON)"
        )
    else:
        print(f"  {name}: {n:,} lots -> {out_path.name} ({size_mb:.1f} MB)")


def main():
    parser = argparse.ArgumentParser(description="Export cleaned CSVs to .bin.")
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
